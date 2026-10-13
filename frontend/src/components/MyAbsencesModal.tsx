import { useEffect, useState } from 'react';
import { listMisSolicitudes, cancelarSolicitud, ApiError } from '../api';
import { Shell } from './modalParts';
import { TarjetaSolicitud } from './TarjetaSolicitud';
import { cancelable, vigenteEnHistorial } from '../solicitudesUx';
import type { SolicitudAusencia } from '../types';

/**
 * Las ausencias propias como SOLICITUDES: cada una con su estado (aplicada y
 * esperando aprobación, aprobada, no aprobada con el motivo, cancelada).
 *
 * Cancelar ya no borra: deja la solicitud cancelada en el historial, y solo
 * se puede antes de que empiece (antes se podía borrar una ausencia ya usada
 * y liberar los minutos del mes sin dejar rastro). Lo resuelto de hace más de
 * un mes se oculta, con un botón para verlo.
 */

export function MyAbsencesModal({ onClose, onChanged, onMoverFeriado }: {
  onClose: () => void;
  /** Se llama tras cancelar, para que el mapa y el estado propio se refresquen. */
  onChanged: () => void;
  /** Abre «Mover un feriado». */
  onMoverFeriado?: () => void;
}) {
  const [rows, setRows] = useState<SolicitudAusencia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [verAnteriores, setVerAnteriores] = useState(false);

  const cargar = async () => {
    setError(null);
    try {
      setRows(await listMisSolicitudes());
    } catch (e) {
      setRows([]);
      const detail = e instanceof ApiError ? (e.detail as { message?: string } | undefined) : undefined;
      setError(detail?.message ?? 'No se pudieron cargar tus solicitudes');
    }
  };

  useEffect(() => { void cargar(); }, []);

  const cancelar = async (id: string) => {
    setCancelando(id);
    setError(null);
    try {
      await cancelarSolicitud(id);
      setConfirmando(null);
      await cargar();
      onChanged();
    } catch (e) {
      const detail = e instanceof ApiError ? (e.detail as { message?: string } | undefined) : undefined;
      setError(detail?.message ?? 'No se pudo cancelar');
    } finally {
      setCancelando(null);
    }
  };

  const ahora = Date.now();
  const todas = rows ?? [];
  const vigentes = todas.filter(s => vigenteEnHistorial(s, ahora));
  const ocultas = todas.length - vigentes.length;
  // Lo que espera respuesta primero, después lo próximo, y lo pasado al final.
  const peso = (s: SolicitudAusencia) => (s.estado === 'pendiente' ? 0 : new Date(s.endAt).getTime() >= ahora ? 1 : 2);
  const lista = [...(verAnteriores ? todas : vigentes)].sort((a, b) =>
    peso(a) - peso(b) || new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  return (
    <Shell title="Mis ausencias y solicitudes" onClose={onClose}>
      {error && <div className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

      {onMoverFeriado && (
        <button onClick={onMoverFeriado} data-testid="mover-feriado"
          className="mb-3 w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-left text-[11px] text-amber-800 hover:bg-amber-100">
          🎉 <span className="font-semibold">Mover un feriado</span> — trabajarlo y tomarlo otro día del mes
        </button>
      )}

      {rows === null && <p className="py-6 text-center text-xs text-gray-400">Cargando…</p>}
      {rows !== null && lista.length === 0 && !error && (
        <p className="py-6 text-center text-xs text-gray-400">No tenés solicitudes recientes.</p>
      )}

      <div className="max-h-80 space-y-2 overflow-y-auto" data-testid="mis-solicitudes">
        {lista.map(s => {
          const enConfirmacion = confirmando === s.id;
          return (
            <TarjetaSolicitud key={s.id} s={s} ahora={ahora}>
              {cancelable(s, ahora) && !enConfirmacion && (
                <button onClick={() => { setConfirmando(s.id); setError(null); }}
                  className="mt-2 rounded-xl px-2 py-1 text-[11px] font-medium text-red-500 hover:bg-red-50">
                  Cancelar
                </button>
              )}
              {cancelable(s, ahora) && enConfirmacion && (
                <div className="mt-2 rounded-xl bg-red-50 p-2">
                  <p className="text-[11px] text-red-700">
                    Queda cancelada en tu historial{s.estado === 'pendiente' ? ' y tu jefe ya no la ve' : ''}.
                  </p>
                  <div className="mt-1.5 flex items-center justify-end gap-2">
                    <button onClick={() => setConfirmando(null)} disabled={cancelando === s.id}
                      className="rounded-xl px-2 py-1 text-[11px] text-gray-500 hover:bg-white disabled:opacity-50">No</button>
                    <button onClick={() => void cancelar(s.id)} disabled={cancelando === s.id}
                      className="rounded-xl bg-red-500 px-2.5 py-1 text-[11px] font-semibold text-white disabled:bg-red-300">
                      {cancelando === s.id ? 'Cancelando…' : 'Sí, cancelar'}
                    </button>
                  </div>
                </div>
              )}
            </TarjetaSolicitud>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        {ocultas > 0 ? (
          <button onClick={() => setVerAnteriores(v => !v)} className="text-[10px] text-gray-500 underline hover:text-gray-700">
            {verAnteriores ? 'Ocultar las de hace más de un mes' : `Mostrar ${ocultas} de hace más de un mes`}
          </button>
        ) : <span />}
        <button onClick={onClose} className="rounded-xl px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100">Cerrar</button>
      </div>
    </Shell>
  );
}
