import { useEffect, useState } from 'react';
import { Shell } from './modalParts';
import { api, ApiError, conectarBitrixUrl } from '../api';

interface Borrador {
  jornada: { estado: string; trabajadoSeg: number };
  reporte: string;
  pideHora: boolean;
  horaSugerida: string | null;
}

/** Con la jornada de Bitrix abierta, salir es terminarla: lleva el informe del día. */
const ABIERTA = new Set(['trabajando', 'en_pausa']);

function duracion(seg: number): string {
  const min = Math.max(0, Math.floor(seg / 60));
  const h = Math.floor(min / 60);
  return h ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
}

/**
 * «Salir» de la oficina, como en Bitrix: si la jornada está abierta pide el
 * informe del día (viene armado con las tareas y reuniones) y lo manda al
 * cerrar. Si no hay jornada abierta o Bitrix no contesta, sale directo.
 *
 * Sin su Bitrix conectado no se puede mandar el informe en su nombre. Antes
 * salía directo sin decir nada y la persona creía que hacía algo mal (Daniela,
 * 15-oct-2026); ahora se le ofrece conectarlo o salir sin informe.
 */
export function InformeSalidaModal({ onClose, onSalio, salirSinInforme }: {
  onClose: () => void;
  onSalio: () => void;
  /** El checkout de siempre (sin informe). */
  salirSinInforme: () => Promise<void>;
}) {
  const [b, setB] = useState<Borrador | null>(null);
  const [sinBitrix, setSinBitrix] = useState(false);
  const [reporte, setReporte] = useState('');
  const [hora, setHora] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.get<Borrador>('/p/office/jornada/borrador')
      .then(async r => {
        if (!vivo) return;
        if (!ABIERTA.has(r.jornada.estado)) { await salirSinInforme(); onSalio(); return; }
        setB(r); setReporte(r.reporte); setHora(r.horaSugerida ?? '');
      })
      .catch(async e => {
        if (!vivo) return;
        // No conectó su Bitrix: el servidor lo marca con `conectar`.
        if (e instanceof ApiError && e.status === 409 && (e.detail as { conectar?: string } | undefined)?.conectar) {
          setSinBitrix(true);
          return;
        }
        // Bitrix caído u otro tropiezo: no se traba a nadie en la oficina.
        await salirSinInforme(); onSalio();
      });
    return () => { vivo = false; };
  }, []);

  function conectar() {
    // La oficina corre en un iframe y Bitrix no se deja enmarcar.
    try {
      (window.top ?? window).location.href = conectarBitrixUrl;
    } catch {
      window.location.href = conectarBitrixUrl;
    }
  }

  if (sinBitrix) {
    return (
      <Shell title="Terminar la jornada" onClose={onClose}>
        <div className="space-y-3" data-testid="informe-sin-bitrix">
          <p className="text-xs leading-relaxed text-gray-700">
            Para mandar tu <b>informe del día</b> a Bitrix, la oficina necesita tu cuenta de Bitrix
            conectada. Se hace una sola vez: te lleva a Bitrix, aceptás y volvés acá.
          </p>
          <button onClick={conectar} data-testid="conectar-bitrix-informe"
            className="w-full rounded-xl bg-gray-900 px-3 py-2.5 text-xs font-semibold text-white hover:bg-gray-700">
            Conectar mi Bitrix
          </button>
          <button disabled={enviando} onClick={async () => { setEnviando(true); try { await salirSinInforme(); onSalio(); } finally { setEnviando(false); } }}
            className="w-full text-center text-[11px] text-gray-500 underline hover:text-gray-700 disabled:opacity-50">
            Salir sin informe (la jornada de Bitrix se cierra igual)
          </button>
        </div>
      </Shell>
    );
  }

  async function enviar() {
    if (!b) return;
    setEnviando(true);
    setError(null);
    try {
      const cuerpo: { reporte: string; hora?: string } = { reporte };
      if (hora && hora !== b.horaSugerida) cuerpo.hora = hora;
      await api.post('/p/office/jornada/terminar', cuerpo);
      onSalio();
    } catch (e) {
      const m = e instanceof ApiError ? (e.detail as { message?: string } | undefined)?.message : null;
      setError(m || 'No se pudo terminar la jornada. Probá de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Shell title="Terminar la jornada" onClose={onClose}>
      {!b ? (
        <p className="py-4 text-center text-xs text-gray-500">Armando el informe con tus tareas y reuniones…</p>
      ) : (
        <div className="space-y-3" data-testid="informe-salida">
          <p className="text-xs text-gray-600">Hoy llevás <b>{duracion(b.jornada.trabajadoSeg)}</b> trabajadas.</p>
          <label className="block">
            <span className="text-[11px] font-semibold text-gray-700">Informe del día</span>
            <textarea value={reporte} onChange={e => setReporte(e.target.value)} maxLength={5000} rows={9}
              placeholder="¿Qué hiciste hoy?"
              className="mt-1 w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-xs leading-relaxed focus:border-gray-400 focus:outline-none" />
            <span className="text-[10px] text-gray-500">Le llega a tu jefe en Bitrix, como el informe de la jornada.</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-gray-700">Hora de salida</span>
            <input type="time" value={hora} onChange={e => setHora(e.target.value)}
              className="rounded-lg border border-gray-200 px-1.5 py-0.5 text-xs" />
          </label>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600" role="alert">{error}</p>}
          <button disabled={enviando || !reporte.trim()} onClick={() => void enviar()}
            className="w-full rounded-xl bg-gray-900 px-3 py-2.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-40">
            {enviando ? 'Enviando…' : 'Enviar informe y salir'}
          </button>
          <button disabled={enviando} onClick={async () => { await salirSinInforme(); onSalio(); }}
            className="w-full text-center text-[11px] text-gray-500 underline hover:text-gray-700">
            Salir sin informe (la jornada de Bitrix se cierra igual)
          </button>
        </div>
      )}
    </Shell>
  );
}
