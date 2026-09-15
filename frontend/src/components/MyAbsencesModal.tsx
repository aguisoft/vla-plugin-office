import { useEffect, useState } from 'react';
import { listAbsences, deleteAbsence, ApiError } from '../api';
import { cfgOf } from '../statusConfig';
import { fmtDate, fmtTime, absenceLastDay } from '../format';
import { Shell } from './modalParts';
import type { Absence } from '../types';

/**
 * Lista las ausencias propias y deja cancelarlas.
 *
 * Existe porque sin esto una ausencia era irreversible desde la interfaz: el
 * backend ya exponía `DELETE /absences/:id` y `api.ts` ya tenía el cliente,
 * pero ningún componente los llamaba. Quien se marcaba vacaciones por error
 * quedaba fuera del mapa hasta que alguien corriera SQL a mano — y como la
 * ausencia le gana al estado del día en el resolver, tampoco podía taparla
 * poniéndose Disponible.
 *
 * Solo pide las propias (`listAbsences()` sin userId). Ver las de otro exige
 * ser su jefe directo o tener office.manage, y esa es otra pantalla.
 */

type Tramo = 'activa' | 'proxima' | 'pasada';

function tramoDe(a: Absence, ahora: number): Tramo {
  const inicio = new Date(a.startAt).getTime();
  const fin = new Date(a.endAt).getTime();
  if (ahora < inicio) return 'proxima';
  if (ahora > fin) return 'pasada';
  return 'activa';
}

/**
 * PERMISO viaja como dos instantes reales dentro del mismo día; VACACIONES e
 * INCAPACIDAD como un rango de días cuyo `endAt` es el último instante del
 * último día fuera. Mostrarlos con el mismo formato haría que un permiso de
 * dos horas se leyera como un día entero.
 */
function cuando(a: Absence): string {
  if (a.type === 'PERMISO') {
    return `${fmtDate(a.startAt)}, de ${fmtTime(a.startAt)} a ${fmtTime(a.endAt)}`;
  }
  const desde = fmtDate(a.startAt);
  const hasta = absenceLastDay(a.endAt);
  return desde === hasta ? desde : `${desde} a ${hasta}`;
}

const ETIQUETA: Record<Tramo, { texto: string; clase: string }> = {
  activa:   { texto: 'En curso',  clase: 'bg-green-100 text-green-700' },
  proxima:  { texto: 'Programada', clase: 'bg-blue-100 text-blue-700' },
  pasada:   { texto: 'Terminada', clase: 'bg-gray-100 text-gray-500' },
};

export function MyAbsencesModal({ onClose, onChanged }: {
  onClose: () => void;
  /** Se llama tras cancelar, para que el mapa y el estado propio se refresquen. */
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<Absence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  const cargar = async () => {
    setError(null);
    try {
      setRows(await listAbsences());
    } catch (e) {
      setRows([]);
      const detail = e instanceof ApiError ? (e.detail as { message?: string } | undefined) : undefined;
      setError(detail?.message ?? 'No se pudieron cargar las ausencias');
    }
  };

  useEffect(() => { void cargar(); }, []);

  const cancelar = async (id: string) => {
    setBorrando(id);
    setError(null);
    try {
      await deleteAbsence(id);
      setConfirmando(null);
      await cargar();
      onChanged();
    } catch (e) {
      const detail = e instanceof ApiError ? (e.detail as { message?: string } | undefined) : undefined;
      setError(detail?.message ?? 'No se pudo cancelar la ausencia');
    } finally {
      setBorrando(null);
    }
  };

  const ahora = Date.now();
  // Vigentes primero (en curso, luego programadas) y las terminadas al final:
  // lo accionable queda arriba sin tener que esconder el historial.
  const orden: Record<Tramo, number> = { activa: 0, proxima: 1, pasada: 2 };
  const ordenadas = rows
    ? [...rows].sort((a, b) => {
        const d = orden[tramoDe(a, ahora)] - orden[tramoDe(b, ahora)];
        return d !== 0 ? d : new Date(a.startAt).getTime() - new Date(b.startAt).getTime();
      })
    : [];

  return (
    <Shell title="Mis ausencias" onClose={onClose}>
      {error && (
        <div className="mb-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
      )}

      {rows === null && (
        <p className="py-6 text-center text-xs text-gray-400">Cargando…</p>
      )}

      {rows !== null && ordenadas.length === 0 && !error && (
        <p className="py-6 text-center text-xs text-gray-400">
          No tenés ausencias registradas.
        </p>
      )}

      <div className="max-h-80 space-y-2 overflow-y-auto">
        {ordenadas.map(a => {
          const cfg = cfgOf(a.type);
          const tramo = tramoDe(a, ahora);
          const et = ETIQUETA[tramo];
          const enConfirmacion = confirmando === a.id;

          return (
            <div key={a.id} className="rounded-xl border border-gray-100 p-3">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${cfg.dot}`} />
                <span className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</span>
                {cfg.icon && <span className="text-xs">{cfg.icon}</span>}
                <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${et.clase}`}>
                  {et.texto}
                </span>
              </div>

              <p className="mt-1 text-[11px] text-gray-500">{cuando(a)}</p>

              {a.justification && (
                <p className="mt-1 text-[11px] italic text-gray-400">«{a.justification}»</p>
              )}

              {/* Las terminadas no se cancelan: borrarlas no cambia nada del
                  presente y solo destruye el historial. */}
              {tramo !== 'pasada' && !enConfirmacion && (
                <button
                  onClick={() => { setConfirmando(a.id); setError(null); }}
                  className="mt-2 rounded-xl px-2 py-1 text-[11px] font-medium text-red-500 hover:bg-red-50"
                >
                  Cancelar ausencia
                </button>
              )}

              {tramo !== 'pasada' && enConfirmacion && (
                <div className="mt-2 rounded-xl bg-red-50 p-2">
                  <p className="text-[11px] text-red-700">
                    {tramo === 'activa'
                      ? 'Se cancela ahora y volvés al mapa enseguida. No se puede deshacer.'
                      : 'Se elimina del calendario. No se puede deshacer.'}
                  </p>
                  <div className="mt-1.5 flex items-center justify-end gap-2">
                    <button
                      onClick={() => setConfirmando(null)}
                      disabled={borrando === a.id}
                      className="rounded-xl px-2 py-1 text-[11px] text-gray-500 hover:bg-white disabled:opacity-50"
                    >
                      No
                    </button>
                    <button
                      onClick={() => void cancelar(a.id)}
                      disabled={borrando === a.id}
                      className="rounded-xl bg-red-500 px-2.5 py-1 text-[11px] font-semibold text-white disabled:bg-red-300"
                    >
                      {borrando === a.id ? 'Cancelando…' : 'Sí, cancelar'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex justify-end">
        <button onClick={onClose} className="rounded-xl px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100">
          Cerrar
        </button>
      </div>
    </Shell>
  );
}
