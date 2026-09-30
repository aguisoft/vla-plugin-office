import { useEffect, useState } from 'react';
import { listSolicitudesFeriadoPendientes, decidirSolicitudFeriado, ApiError } from '../api';
import { MIN_JUSTIFICATION } from '../statusConfig';
import { fmtDateOnly } from '../format';
import type { SolicitudFeriado } from '../types';

/**
 * La bandeja del jefe: lo que su gente pidió para mover un feriado y él
 * todavía no respondió.
 *
 * Se monta en la pestaña de equipo porque ahí es donde el jefe ya mira a los
 * suyos, y porque el backend define los pendientes como los de sus
 * subordinados directos — el mismo conjunto que arma esa pantalla.
 *
 * Si no hay nada pendiente no se dibuja nada. Un panel vacío permanente
 * entrena a no mirarlo, y entonces no sirve el día que sí tiene algo.
 */
export function HolidayRequestsPanel({ nombreDe, onDecidido }: {
  nombreDe: (userId: string) => string | null;
  /** Refresca la tabla: aprobar mueve un feriado y con él el denominador. */
  onDecidido: () => void;
}) {
  const [solicitudes, setSolicitudes] = useState<SolicitudFeriado[]>([]);
  const [rechazando, setRechazando] = useState<string | null>(null);
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listSolicitudesFeriadoPendientes().then(setSolicitudes).catch(() => setSolicitudes([]));
  }, []);

  async function decidir(id: string, accion: 'approve' | 'reject') {
    setEnviando(id);
    setError(null);
    try {
      await decidirSolicitudFeriado(id, accion, accion === 'reject' ? nota.trim() : undefined);
      setSolicitudes(prev => prev.filter(s => s.id !== id));
      setRechazando(null);
      setNota('');
      onDecidido();
    } catch (e) {
      const detail = e instanceof ApiError ? (e.detail as { message?: string; errors?: Array<{ message: string }> } | undefined) : undefined;
      setError(detail?.errors?.[0]?.message ?? detail?.message ?? 'No se pudo responder la solicitud');
    } finally {
      setEnviando(null);
    }
  }

  if (solicitudes.length === 0) return null;

  const faltan = Math.max(0, MIN_JUSTIFICATION - nota.trim().length);

  return (
    <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
      <h3 className="mb-2 text-xs font-medium text-amber-900">
        Feriados que tu equipo quiere tomar otro día
        <span className="ml-1.5 font-normal text-amber-700">({solicitudes.length})</span>
      </h3>

      {error && <p className="mb-2 text-[11px] text-rose-700">{error}</p>}

      <ul className="space-y-2">
        {solicitudes.map(s => {
          // Un userId crudo no le dice nada a nadie: si el nombre no llegó, se
          // dice que no está disponible en vez de imprimir el identificador.
          const quien = nombreDe(s.userId) ?? 'Colaborador no disponible';
          const ocupado = enviando === s.id;
          return (
            <li key={s.id} className="rounded-xl bg-white p-2.5 text-[11px]">
              <p className="font-medium text-gray-800">{quien}</p>
              <p className="text-gray-600">
                {s.holidayName ?? 'Feriado que ya no existe'}
                {s.holidayDate && <> del {fmtDateOnly(s.holidayDate)}</>}
                {' → '}lo tomaría el {fmtDateOnly(s.newDate)}
              </p>
              <p className="mt-0.5 italic text-gray-500">«{s.justification}»</p>

              {rechazando === s.id ? (
                <div className="mt-2">
                  <textarea
                    value={nota}
                    onChange={e => setNota(e.target.value)}
                    rows={2}
                    placeholder="Ese viernes cerramos planilla"
                    className="w-full resize-none rounded-lg border border-gray-200 p-2 text-[11px]"
                  />
                  <div className="mt-1.5 flex gap-2">
                    <button
                      type="button"
                      disabled={faltan > 0 || ocupado}
                      onClick={() => decidir(s.id, 'reject')}
                      className="rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] text-white disabled:opacity-40"
                    >
                      {faltan > 0 ? `Faltan ${faltan}` : 'Rechazar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRechazando(null); setNota(''); }}
                      className="rounded-lg px-2.5 py-1 text-[11px] text-gray-500"
                    >
                      Cancelar
                    </button>
                  </div>
                  <p className="mt-1 text-[10px] text-gray-400">
                    Rechazar exige explicar por qué: quien se queda sin mover su
                    feriado tiene que poder leer el motivo.
                  </p>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => decidir(s.id, 'approve')}
                    className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] text-white disabled:opacity-40"
                  >
                    Aprobar
                  </button>
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => { setRechazando(s.id); setNota(''); }}
                    className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] text-gray-600 disabled:opacity-40"
                  >
                    Rechazar
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
