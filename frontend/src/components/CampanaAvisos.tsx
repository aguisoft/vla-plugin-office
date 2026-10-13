import { useCallback, useEffect, useRef, useState } from 'react';
import { getAvisos, marcarAvisosLeidos, getClaveNavegador, suscribirNavegador } from '../api';
import { haceCuanto, estadoNavegador, claveABytes, type EstadoNavegador } from '../avisosUx';
import type { Aviso } from '../types';

/**
 * La campana: lo que se le avisó a la persona (solicitudes, respuestas,
 * feriados), aunque no estuviera conectada cuando pasó. Los mensajes del chat
 * no entran: tienen su propio contador. Abajo, el estado de los avisos del
 * navegador, con el botón para activarlos.
 */

async function leerNavegador(): Promise<{ estado: EstadoNavegador; reg: ServiceWorkerRegistration | null }> {
  const soportado = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!soportado) return { estado: 'no-disponible', reg: null };
  const reg = (await navigator.serviceWorker.getRegistration().catch(() => undefined)) ?? null;
  const suscrito = !!(reg && (await reg.pushManager.getSubscription().catch(() => null)));
  return { estado: estadoNavegador({ soportado: !!reg, permiso: Notification.permission, suscrito }), reg };
}

const TEXTO_NAVEGADOR: Record<EstadoNavegador, string> = {
  activo: 'Avisos del navegador activos',
  inactivo: 'Los avisos del navegador están apagados',
  bloqueado: 'El navegador bloqueó los avisos: habilitalos desde el candado de la barra de direcciones',
  'no-disponible': '',
};

export function CampanaAvisos({ recarga, onAbrir }: {
  /** Cambia cuando llega un aviso en vivo: la campana se vuelve a cargar. */
  recarga: number;
  onAbrir: (url: string) => void;
}) {
  const [abierta, setAbierta] = useState(false);
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const [sinLeer, setSinLeer] = useState(0);
  const [navegador, setNavegador] = useState<EstadoNavegador>('no-disponible');
  const [activando, setActivando] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await getAvisos();
      setAvisos(r.avisos);
      setSinLeer(r.sinLeer);
    } catch { /* la campana es accesoria: sin ella la oficina sigue */ }
  }, []);
  useEffect(() => { void cargar(); }, [cargar, recarga]);
  useEffect(() => { if (abierta) void leerNavegador().then(n => setNavegador(n.estado)); }, [abierta]);

  // Clic afuera la cierra.
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: MouseEvent) => { if (caja.current && !caja.current.contains(e.target as Node)) setAbierta(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierta]);

  const abrir = async (a: Aviso) => {
    setAbierta(false);
    if (!a.leidoEn) {
      setAvisos(prev => prev?.map(x => (x.id === a.id ? { ...x, leidoEn: new Date().toISOString() } : x)) ?? null);
      setSinLeer(n => Math.max(0, n - 1));
      void marcarAvisosLeidos([a.id]).catch(() => undefined);
    }
    if (a.url) onAbrir(a.url);
  };

  const leerTodo = async () => {
    setAvisos(prev => prev?.map(x => (x.leidoEn ? x : { ...x, leidoEn: new Date().toISOString() })) ?? null);
    setSinLeer(0);
    await marcarAvisosLeidos().catch(() => undefined);
  };

  const activarNavegador = async () => {
    setActivando(true);
    try {
      const { reg } = await leerNavegador();
      const { clave } = await getClaveNavegador();
      if (!reg || !clave) return;
      if ((await Notification.requestPermission()) !== 'granted') return;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveABytes(clave).buffer as ArrayBuffer });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await suscribirNavegador({ endpoint: json.endpoint, keys: json.keys });
    } catch { /* queda como estaba; el estado de abajo lo dice */ }
    finally {
      setActivando(false);
      setNavegador((await leerNavegador()).estado);
    }
  };

  const ahora = Date.now();
  return (
    <div className="relative" ref={caja}>
      <button onClick={() => setAbierta(v => !v)} data-testid="campana-avisos" aria-label={sinLeer ? `Avisos: ${sinLeer} sin leer` : 'Avisos'}
        className="relative flex items-center rounded-xl px-2 py-1.5 text-gray-500 transition-colors hover:bg-gray-100">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {sinLeer > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[9px] font-semibold leading-4 text-white">
            {sinLeer > 99 ? '99+' : sinLeer}
          </span>
        )}
      </button>

      {abierta && (
        <div className="absolute right-0 top-full z-50 mt-2 flex max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] flex-col rounded-2xl border border-gray-100 bg-white shadow-xl" data-testid="panel-avisos">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <span className="text-xs font-semibold text-gray-800">Avisos</span>
            {sinLeer > 0 && (
              <button onClick={() => void leerTodo()} className="text-[10px] text-sky-700 hover:underline">Marcar todo como leído</button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {avisos === null && <p className="py-6 text-center text-xs text-gray-400">Cargando…</p>}
            {avisos?.length === 0 && <p className="py-8 text-center text-xs text-gray-400">No tenés avisos.</p>}
            {avisos?.map(a => (
              <button key={a.id} onClick={() => void abrir(a)}
                className={`flex w-full gap-2.5 border-b border-gray-50 px-4 py-2.5 text-left hover:bg-gray-50 ${a.leidoEn ? '' : 'bg-sky-50/40'}`}>
                <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${a.leidoEn ? 'bg-transparent' : 'bg-sky-500'}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block text-[11px] ${a.leidoEn ? 'text-gray-600' : 'font-semibold text-gray-800'}`}>{a.titulo}</span>
                  {a.cuerpo && <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">{a.cuerpo}</span>}
                  <span className="mt-0.5 block text-[10px] text-gray-400">{haceCuanto(a.creadoEn, ahora)}</span>
                </span>
              </button>
            ))}
          </div>

          {navegador !== 'no-disponible' && (
            <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-2.5 text-[10px] text-gray-500" data-testid="avisos-navegador">
              <span className="flex-1">{TEXTO_NAVEGADOR[navegador]}</span>
              {navegador === 'inactivo' && (
                <button onClick={() => void activarNavegador()} disabled={activando}
                  className="shrink-0 rounded-lg bg-sky-600 px-2 py-1 font-semibold text-white hover:bg-sky-700 disabled:opacity-50">
                  {activando ? 'Activando…' : 'Activar'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
