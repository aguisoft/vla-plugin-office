import { useEffect, useState } from 'react';
import { getBandejaSolicitudes, responderSolicitud, decidirSolicitudFeriado, urlAdjunto, ApiError } from '../api';
import { cfgOf } from '../statusConfig';
import { fmtDate, fmtTime, fmtDateOnly, absenceLastDay } from '../format';
import type { BandejaSolicitudes, SolicitudAusencia } from '../types';

/**
 * La bandeja del jefe (y de RRHH): todo lo que su gente pidió y espera
 * respuesta — ausencias y feriados movidos — en un solo lugar. Antes los
 * feriados estaban escondidos en Tiempos y las ausencias no se aprobaban.
 * Aprobar es un clic; rechazar pide el motivo, que le llega a la persona.
 */

const MIN_MOTIVO = 5;

function cuando(s: SolicitudAusencia): string {
  if (s.tipo === 'PERMISO' || s.tipo === 'CITA_MEDICA') return `${fmtDate(s.startAt)}, de ${fmtTime(s.startAt)} a ${fmtTime(s.endAt)}`;
  const a = absenceLastDay(s.startAt);
  const b = absenceLastDay(s.endAt);
  return a === b ? a : `${a} a ${b}`;
}

const errorDe = (e: unknown, def: string) =>
  (e instanceof ApiError ? (e.detail as { message?: string } | undefined)?.message : undefined) ?? def;

export function BandejaSolicitudesModal({ onClose, onCambio }: { onClose: () => void; onCambio: () => void }) {
  const [b, setB] = useState<BandejaSolicitudes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');

  const cargar = async () => {
    try { setB(await getBandejaSolicitudes()); }
    catch (e) { setError(errorDe(e, 'No se pudo cargar la bandeja')); setB({ ausencias: [], feriados: [], esJefe: false, esRrhh: false }); }
  };
  useEffect(() => { void cargar(); }, []);

  async function hacer(id: string, f: () => Promise<unknown>) {
    setOcupado(id); setError(null);
    try { await f(); setRechazando(null); setMotivo(''); await cargar(); onCambio(); }
    catch (e) { setError(errorDe(e, 'No se pudo responder')); }
    finally { setOcupado(null); }
  }

  const total = (b?.ausencias.length ?? 0) + (b?.feriados.length ?? 0);

  /** Los dos botones (o la caja del motivo) de cada pedido. */
  const acciones = (id: string, aprobar: () => Promise<unknown>, rechazar: (m: string) => Promise<unknown>) => (
    rechazando === id ? (
      <div className="mt-2 space-y-1.5">
        <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2} autoFocus
          placeholder="Por qué no (le llega a la persona)" aria-label="Motivo"
          className="w-full resize-none rounded-lg border border-gray-200 p-2 text-[11px]" />
        <div className="flex justify-end gap-2">
          <button onClick={() => { setRechazando(null); setMotivo(''); }} className="px-2 text-[11px] text-gray-500">Volver</button>
          <button disabled={motivo.trim().length < MIN_MOTIVO || ocupado === id} onClick={() => void hacer(id, () => rechazar(motivo.trim()))}
            className="rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40">No aprobar</button>
        </div>
      </div>
    ) : (
      <div className="mt-2 flex justify-end gap-2">
        <button disabled={ocupado === id} onClick={() => { setRechazando(id); setMotivo(''); }}
          className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40">No aprobar</button>
        <button disabled={ocupado === id} onClick={() => void hacer(id, aprobar)} data-testid={`aprobar-${id}`}
          className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
          {ocupado === id ? 'Guardando…' : 'Aprobar'}
        </button>
      </div>
    )
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()} data-testid="bandeja-solicitudes">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">Solicitudes por responder</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Cerrar">✕</button>
        </div>
        <p className="mb-3 text-[10px] text-gray-500">
          {b?.esRrhh ? 'Como RRHH ves las de todo el equipo.' : 'Las de tu equipo directo.'} Lo que respondas le llega a la persona.
        </p>
        {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-600">{error}</p>}
        {!b && <p className="py-6 text-center text-xs text-gray-400">Cargando…</p>}
        {b && total === 0 && <p className="py-8 text-center text-xs text-gray-400">No hay nada pendiente. 🎉</p>}

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {b?.ausencias.map(s => {
            const cfg = cfgOf(s.tipo);
            return (
              <div key={s.id} className="rounded-xl border border-gray-100 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-800">{s.nombre ?? 'Alguien del equipo'}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.text}`} style={{ backgroundColor: `${cfg.color}22` }}>
                    {cfg.icon} {cfg.label}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-gray-600">{cuando(s)}</p>
                <p className="text-[10px] text-gray-400">
                  {s.tipo === 'VACACIONES' ? 'No vale hasta que la apruebes.' : 'Ya está aplicada; si no la aprobás y no empezó, se quita.'}
                </p>
                {s.justificacion && <p className="mt-1 text-[11px] italic text-gray-500">«{s.justificacion}»</p>}
                {s.usoMes && s.tipo === 'PERMISO' && (
                  <p className={`mt-1 text-[10px] ${s.usoMes.permisoMin > s.usoMes.permisoTopeMin ? 'font-semibold text-amber-700' : 'text-gray-500'}`}>
                    Este mes lleva {s.usoMes.permisoMin} min de permiso de {s.usoMes.permisoTopeMin}
                  </p>
                )}
                {!!s.adjuntos?.length && (
                  <p className="mt-1 flex flex-wrap gap-2">
                    {s.adjuntos.map(d => (
                      <a key={d.id} href={urlAdjunto(d.id)} target="_blank" rel="noreferrer"
                        className="text-[11px] text-sky-700 underline decoration-dotted underline-offset-2">📎 {d.nombre}</a>
                    ))}
                  </p>
                )}
                {acciones(s.id, () => responderSolicitud(s.id, 'aprobar'), m => responderSolicitud(s.id, 'rechazar', m))}
              </div>
            );
          })}

          {b?.feriados.map(f => (
            <div key={f.id} className="rounded-xl border border-gray-100 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-800">{f.nombre ?? 'Alguien del equipo'}</span>
                <span className="ml-auto rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">🎉 Mover feriado</span>
              </div>
              <p className="mt-1 text-[11px] text-gray-600">
                Trabaja {f.holidayName ?? 'el feriado'}{f.holidayDate ? ` (${fmtDateOnly(f.holidayDate)})` : ''} y lo toma el {fmtDateOnly(f.newDate)}
              </p>
              {f.justification && <p className="mt-1 text-[11px] italic text-gray-500">«{f.justification}»</p>}
              {acciones(f.id, () => decidirSolicitudFeriado(f.id, 'approve'), m => decidirSolicitudFeriado(f.id, 'reject', m))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
