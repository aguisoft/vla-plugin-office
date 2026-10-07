import { useEffect, useState } from 'react';
import { getPlanta, regarPlanta, type Planta } from '../api';
import { PlantaDibujo } from './PlantaDibujo';

type EstadoPlanta = 'feliz' | 'sed' | 'marchita' | 'seca';


/** Solo el tono del texto: el color de la planta ya viene en la imagen. */
const TONO: Record<EstadoPlanta, string> = {
  feliz: 'text-emerald-600', sed: 'text-lime-700',
  marchita: 'text-amber-700', seca: 'text-stone-600',
};
const FRASE: Record<EstadoPlanta, string> = {
  feliz: 'Está contenta', sed: 'Tiene sed', marchita: 'Se está marchitando', seca: 'Necesita rescate',
};

/**
 * La planta de la oficina. Cualquiera puede regarla cuando tiene sed; regarla
 * contenta no suma, para que el gesto no se gaste a fuerza de repetirlo.
 *
 * Quién la regó se marca junto a su avatar (ver `regadoPor` en la grilla), y
 * cada quien lleva su propia cuenta. No hay ranking: la idea es que sea un
 * gusto compartido, no una competencia.
 */
export function PlantaOficina({ onRegada, nombreDe }: {
  onRegada?: (userId: string) => void;
  /** Nombre de pila de alguien de la oficina, para «Última vez: Carlos». */
  nombreDe?: (userId: string) => string | null;
}) {
  const [p, setP] = useState<Planta | null>(null);
  const [regando, setRegando] = useState(false);
  const [festejo, setFestejo] = useState<string | null>(null);

  // Si falla se deja rastro en consola: un catch mudo escondió un 404 de ruta
  // durante todo un despliegue, y la planta simplemente no aparecía.
  // Al cargar también se avisa quién la regó: antes solo se marcaba a quien la
  // regaba en esa misma sesión, y al abrir la oficina nadie tenía la 🌱 (7-oct-2026).
  const cargar = () => getPlanta()
    .then(r => { setP(r); if (r.ultimoRiegoPor && onRegada) onRegada(r.ultimoRiegoPor); })
    .catch(e => console.warn("planta:", e));
  useEffect(() => {
    cargar();
    // La planta cambia de estado en horas: revisar cada 5 minutos alcanza.
    const id = setInterval(cargar, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  if (!p) return null;
  const tono = TONO[p.estado];

  async function regar() {
    if (!p?.puedeRegar || regando) return;
    setRegando(true);
    try {
      const r = await regarPlanta();
      setP(r);
      setFestejo(r.fueRescate ? '¡La rescataste! 🌱' : '¡Gracias por regarla! 💧');
      setTimeout(() => setFestejo(null), 3500);
      if (r.ultimoRiegoPor && onRegada) onRegada(r.ultimoRiegoPor);
    } catch {
      // Otra persona se adelantó: se refresca y queda regada igual.
      cargar();
    } finally {
      setRegando(false);
    }
  }

  return (
    <div className="mt-6 flex items-center justify-center gap-3 text-[11px] text-gray-500">
      <PlantaDibujo estado={p.estado} size={44} regando={regando} festeja={!!festejo} />

      <div className="leading-tight">
        <p className={tono}>
          {FRASE[p.estado]}
          {p.estado === 'seca' && p.horasSinAgua != null && (
            <> · {Math.floor(p.horasSinAgua / 24)} días sin agua</>
          )}
        </p>
        {p.ultimoRiegoPor && (
          <p className="text-[10px] text-gray-400" data-testid="planta-ultimo-riego">
            Última vez: {nombreDe?.(p.ultimoRiegoPor) ?? 'alguien del equipo'}
            {p.ultimoRiegoEn && <>, {haceCuanto(p.ultimoRiegoEn)}</>}
          </p>
        )}
        {p.misRiegos > 0 && (
          <p className="text-[10px] text-gray-400">La regaste {p.misRiegos} {p.misRiegos === 1 ? 'vez' : 'veces'}</p>
        )}
      </div>

      {p.puedeRegar && (
        <button
          onClick={regar}
          disabled={regando}
          className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50"
        >
          💧 {regando ? 'Regando…' : p.seriaRescate ? 'Rescatar' : 'Regar'}
        </button>
      )}

      {festejo && <span className="text-[11px] text-emerald-600">{festejo}</span>}
    </div>
  );
}

/** «hace 5 min», «hace 3 h», «hace 2 días». */
function haceCuanto(iso: string, ahora = new Date()): string {
  const min = Math.max(0, Math.floor((ahora.getTime() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}
