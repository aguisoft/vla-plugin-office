import { useEffect, useRef, useState } from 'react';
import { ROBOT as robot } from '../assets/robot-oficina';
import { descargaEscritorioUrl, descargaEscritorioLinuxUrl, getEscritorioMio } from '../api';
import {
  CLAVE_POSPONER, debeOfrecer, leerPospuesto, ofertaForzada, posponerHasta, textoCompaneros, sistemaDelNavegador, publicadaPara,
  type UsoEscritorio,
} from '../lib/escritorio';

/** Windows o Linux, según desde dónde se abre la oficina (20-oct-2026). */
const SISTEMA = sistemaDelNavegador(typeof navigator === 'undefined' ? '' : navigator.userAgent);
const LINUX = SISTEMA === 'linux';
const URL_DESCARGA = LINUX ? descargaEscritorioLinuxUrl : descargaEscritorioUrl;

type Fase = 'oferta' | 'instalando' | 'lista';

/** Cada cuánto se pregunta si la app ya entró, y hasta cuándo. */
const CADA_MS = 5_000;
const HASTA_MS = 20 * 60_000;

function forzadaEnUrl(): boolean {
  let arriba: string | null = null;
  try { arriba = window.parent.location.search; } catch { /* otro origen */ }
  return ofertaForzada(window.location.search, arriba);
}

function leerPosponer(): number | null {
  try { return leerPospuesto(localStorage.getItem(CLAVE_POSPONER)); } catch { return null; }
}

/**
 * La app de escritorio, ofrecida arriba de la oficina a quien no la tiene:
 * qué gana, un botón para bajarla y, después de bajarla, los pasos de
 * Windows hasta que la app entra (se detecta sola por su latido).
 */
export function OfertaEscritorio({ uso, onCambio }: {
  uso: UsoEscritorio | null;
  /** La app entró: la oficina vuelve a pedir el estado (el botón «Escritorio» deja de insistir). */
  onCambio: (u: UsoEscritorio) => void;
}) {
  const [fase, setFase] = useState<Fase>('oferta');
  const [pospuesto, setPospuesto] = useState<number | null>(leerPosponer);
  const desde = useRef(0);
  const [forzada] = useState(forzadaEnUrl);

  // Después de bajarla: preguntar cada pocos segundos si la app ya entró.
  useEffect(() => {
    if (fase !== 'instalando') return;
    desde.current = Date.now();
    const t = setInterval(() => {
      if (Date.now() - desde.current > HASTA_MS) { clearInterval(t); return; }
      void getEscritorioMio().then(u => {
        if (u.instalada) { setFase('lista'); onCambio(u); }
      }).catch(() => undefined);
    }, CADA_MS);
    return () => clearInterval(t);
  }, [fase, onCambio]);

  // El «listo» se va solo.
  useEffect(() => {
    if (fase !== 'lista') return;
    const t = setTimeout(() => setFase('oferta'), 12_000);
    return () => clearTimeout(t);
  }, [fase]);

  if (fase === 'lista') {
    return (
      <div className="flex-shrink-0 mx-5 mt-3 flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 px-4 py-3" data-testid="escritorio-lista" role="status">
        <img src={robot} alt="" className="h-10 w-10" />
        <p className="text-xs text-green-800">
          <b>¡Listo! VLA Oficina ya está en tu computadora.</b> {LINUX ? 'La encontrás en el menú de aplicaciones y te avisa cuando te escriben.' : 'Vive junto al reloj de Windows: ahí te avisa cuando te escriben.'}
        </p>
      </div>
    );
  }

  const p = publicadaPara(uso, SISTEMA);
  if (fase === 'oferta' && !(forzada && p) && !debeOfrecer(uso, pospuesto, Date.now(), SISTEMA)) return null;
  const companeros = textoCompaneros(uso?.companeros ?? 0);

  if (fase === 'instalando') {
    return (
      <div className="flex-shrink-0 mx-5 mt-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm" data-testid="escritorio-instalando">
        <div className="flex items-start gap-3">
          <img src={robot} alt="" className="h-10 w-10 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold text-gray-900">Ya casi: tres pasos</p>
            <ol className="mt-1.5 space-y-1.5 text-xs text-gray-700">
              <li className="flex gap-2"><span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 text-[9px] font-bold text-white">1</span>
                {LINUX
                  ? <span>Mové <b>VLA-Oficina.AppImage</b> de Descargas a tu carpeta personal: desde ahí se actualiza solo.</span>
                  : <span>Abrí <b>VLA-Oficina-Setup</b> desde las descargas del navegador (arriba a la derecha, o abajo).</span>}</li>
              <li className="flex gap-2"><span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 text-[9px] font-bold text-white">2</span>
                {LINUX
                  ? <span>Clic derecho → <b>Propiedades</b> → <b>Permitir ejecutar como programa</b>, y doble clic. Si no abre, instalá <b>libfuse2</b>.</span>
                  : <span>Si Windows dice <b>«Windows protegió su PC»</b>, tocá <b>Más información</b> y después <b>Ejecutar de todos modos</b>. Es normal: la app es nuestra.</span>}</li>
              <li className="flex gap-2"><span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-gray-900 text-[9px] font-bold text-white">3</span>
                <span>Se abre sola: tocá <b>Entrar con Bitrix</b>. Listo.</span></li>
            </ol>
            <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
                Esperando a que la app entre…
              </span>
              <a href={URL_DESCARGA} download className="underline hover:text-gray-700">¿No se descargó? Bajarla de nuevo</a>
              <button onClick={() => setFase('oferta')} className="underline hover:text-gray-700">Cerrar</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 mx-5 mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-white to-orange-50 px-4 py-3 shadow-sm"
      data-testid="oferta-escritorio">
      <img src={robot} alt="" className="h-11 w-11 flex-shrink-0" />
      <div className="min-w-[220px] flex-1">
        <p className="text-[13px] font-bold text-gray-900">Instalá VLA Oficina en tu computadora</p>
        <p className="text-xs text-gray-600">Te avisa al instante cuando te escriben, y cambiás tu estado o llevás tu jornada sin abrir el navegador.</p>
        <p className="mt-0.5 text-[10px] text-gray-500">
          {[companeros, LINUX ? 'Para Linux' : 'Para Windows', p?.tamanoTexto, 'Se actualiza sola'].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <a href={URL_DESCARGA} download onClick={() => setFase('instalando')} data-testid="descargar-escritorio"
          className="flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-gray-700">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" /></svg>
          Descargar
        </a>
        <button data-testid="posponer-escritorio"
          onClick={() => {
            const hasta = posponerHasta(Date.now());
            try { localStorage.setItem(CLAVE_POSPONER, String(hasta)); } catch { /* sin almacenamiento: vuelve a aparecer */ }
            setPospuesto(hasta);
          }}
          className="rounded-xl px-2.5 py-2 text-[11px] text-gray-500 hover:bg-white/70 hover:text-gray-700">
          Ahora no
        </button>
      </div>
    </div>
  );
}
