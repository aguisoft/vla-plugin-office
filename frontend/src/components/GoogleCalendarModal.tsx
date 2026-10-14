import { useEffect, useState } from 'react';
import { getGoogleEstado, conectarGoogle, desconectarGoogle, ApiError, type EstadoGoogle } from '../api';
import { Shell } from './modalParts';
import { mensajeResultadoGoogle, type ResultadoGoogle } from '../googleUx';

/**
 * Conectar el Google Calendar propio (14-oct-2026). Con eso: las ausencias y
 * los feriados aparecen en Google como «Fuera de la oficina», una reunión de
 * Google pone «En reunión» en la oficina, al invitar se ve si está ocupado y
 * las reuniones de la oficina se crean en Google con Meet.
 */
export function GoogleCalendarModal({ onClose, resultado }: { onClose: () => void; resultado: ResultadoGoogle | null }) {
  const [estado, setEstado] = useState<EstadoGoogle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = () => getGoogleEstado().then(setEstado).catch(() => setError('No se pudo consultar el estado.'));
  useEffect(() => { void cargar(); }, []);

  const conectar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const { url } = await conectarGoogle();
      // Google no se deja mostrar dentro de un iframe: se va la página entera.
      (window.top ?? window).location.href = url;
    } catch (e) {
      const d = e instanceof ApiError ? (e.detail as { message?: string } | undefined) : undefined;
      setError(d?.message ?? 'No se pudo abrir Google.');
      setOcupado(false);
    }
  };
  const desconectar = async () => {
    setOcupado(true);
    try { setEstado(await desconectarGoogle()); } catch { setError('No se pudo desconectar.'); }
    setOcupado(false);
  };

  const aviso = resultado ? mensajeResultadoGoogle(resultado) : null;
  return (
    <Shell title="Google Calendar" onClose={onClose}>
      <div data-testid="google-calendar">
        {aviso && (
          <p className={`mb-3 rounded-xl px-3 py-2 text-xs ${aviso.tono === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>{aviso.texto}</p>
        )}
        <ul className="mb-3 space-y-1.5 text-[11px] leading-relaxed text-gray-600">
          <li>🏖️ Tus vacaciones, permisos, citas y feriados, ya aprobados, aparecen en tu calendario como <b>Fuera de la oficina</b>.</li>
          <li>📅 Cuando tenés una reunión en Google, en la oficina aparecés <b>En reunión</b>, y al terminar volvés a Disponible.</li>
          <li>👀 Al invitarte a una reunión, los demás ven si estás ocupado en Google.</li>
          <li>🎥 Las reuniones que armás en la oficina se crean en tu calendario con enlace de <b>Meet</b>.</li>
        </ul>
        {estado === null && !error && <p className="text-xs text-gray-400">Consultando…</p>}
        {estado && !estado.configurado && !estado.conectado && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Todavía no está habilitado. Avisale a un administrador.</p>
        )}
        {estado?.conectado && (
          <p className="rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700" data-testid="google-conectado">
            Conectado con <b>{estado.email}</b>.
          </p>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <div className="mt-3 flex items-center justify-between gap-2">
          {estado?.conectado ? (
            <button onClick={() => void desconectar()} disabled={ocupado} className="text-[11px] text-gray-500 underline hover:text-gray-700 disabled:opacity-50">
              Desconectar
            </button>
          ) : <span />}
          {estado && !estado.conectado && estado.configurado && (
            <button onClick={() => void conectar()} disabled={ocupado} data-testid="conectar-google"
              className="rounded-xl bg-gray-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50">
              Conectar mi Google Calendar
            </button>
          )}
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-gray-400">
          Solo cuentas @grupovla.com o @vlacademy.com. La oficina crea y borra únicamente sus propios eventos, y mira la reunión que tenés en el momento para ponerte «En reunión» con su título, que ve toda la oficina. Si una reunión no se tiene que ver, marcala como privada en Google: entonces solo dice «Reunión».
        </p>
      </div>
    </Shell>
  );
}
