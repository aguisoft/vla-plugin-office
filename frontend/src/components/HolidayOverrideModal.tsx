import { useEffect, useState } from 'react';
import { listMovableHolidays, listMisSolicitudesFeriado } from '../api';
import { MIN_JUSTIFICATION } from '../statusConfig';
import { fmtDateOnly, monthName } from '../format';
import { Shell, DateField, Actions, missingLabel } from './modalParts';
import type { Holiday, SolicitudFeriado } from '../types';

/**
 * El colaborador PIDE tomar un feriado otro día del mismo mes (p. ej. trabajar
 * el 15 por cierre de mes y tomarlo el 25). Es una solicitud, no un hecho: la
 * aprueba su jefe directo, y hasta entonces el feriado sigue en su fecha
 * original. Toda la redacción de esta pantalla sostiene esa diferencia — decir
 * "listo" cuando todavía falta el visto bueno haría que alguien no viniera a
 * trabajar un día que no tiene libre.
 *
 * El backend exige que la fecha nueva caiga en el mismo mes que el feriado;
 * `monthBounds` acota el `<input type="date">` a eso para que el 400 del
 * backend quede como red y no como la única defensa.
 */
export function HolidayOverrideModal({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (holidayId: string, newDate: string, justification: string) => void;
}) {
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [solicitudes, setSolicitudes] = useState<SolicitudFeriado[]>([]);
  const [holidayId, setHolidayId] = useState('');
  const [newDate, setNewDate] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    // Sin `.catch`, un 401/500 acá queda como rejection sin manejar. Si la
    // carga falla, el modal cae en el mismo estado vacío que "no hay
    // feriados" -- no hay nada mejor que mostrar de todas formas.
    void listMovableHolidays().then(setHolidays).catch(() => setHolidays([]));
    // El historial es accesorio: si falla, el modal sigue sirviendo para pedir.
    void listMisSolicitudesFeriado().then(setSolicitudes).catch(() => setSolicitudes([]));
  }, []);

  const chosen = holidays?.find(h => h.id === holidayId);
  // Mismo mes que el feriado: el backend exige exactamente esto.
  const bounds = chosen ? monthBounds(chosen.date) : null;
  const missing = Math.max(0, MIN_JUSTIFICATION - text.trim().length);
  const ready = !!chosen && !!newDate && missing === 0;

  if (holidays && holidays.length === 0) {
    // Tres causas distintas para la misma lista vacía -- ya pidió mover todos
    // los feriados de su país, tiene solicitudes en curso, o RRHH todavía no
    // cargó el calendario. El historial de abajo desambigua las dos primeras.
    return (
      <Shell title="Feriados" onClose={onClose}>
        <p className="text-xs text-gray-500">
          No hay feriados disponibles para pedir. Ya pediste mover todos los de
          tu país, o RRHH todavía no cargó el calendario.
        </p>
        <Historial solicitudes={solicitudes} />
      </Shell>
    );
  }

  return (
    <Shell title="Pedir mover un feriado" onClose={onClose}>
      <p className="mb-3 text-[10px] leading-relaxed text-gray-500">
        Lo aprueba tu jefe directo. Hasta que responda, el feriado sigue en su
        fecha original.
      </p>
      <select
        value={holidayId}
        onChange={e => { setHolidayId(e.target.value); setNewDate(''); }}
        className="mb-3 w-full rounded-xl border border-gray-200 p-2 text-xs"
      >
        <option value="">Elegí el feriado…</option>
        {holidays?.map(h => (
          <option key={h.id} value={h.id}>{h.name} — {fmtDateOnly(h.date)}</option>
        ))}
      </select>

      {bounds && (
        <DateField
          label="Lo tomo el"
          value={newDate}
          min={bounds.min}
          max={bounds.max}
          onChange={setNewDate}
        />
      )}
      {chosen && (
        <p className="mt-1 text-[10px] text-gray-400">
          Solo se puede mover a otra fecha de {monthName(chosen.date)}.
        </p>
      )}

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={2}
        placeholder="Trabajo el 15 por cierre de mes y lo tomo el 25"
        className="mt-3 w-full resize-none rounded-xl border border-gray-200 p-2.5 text-xs"
      />
      <Actions
        onClose={onClose}
        disabled={!ready}
        confirmLabel={missing > 0 ? missingLabel(missing) : 'Enviar solicitud'}
        onConfirm={() => onConfirm(holidayId, newDate, text.trim())}
      />
      <Historial solicitudes={solicitudes} />
    </Shell>
  );
}

const ETIQUETA: Record<SolicitudFeriado['status'], { texto: string; clase: string }> = {
  PENDING:  { texto: 'Esperando a tu jefe', clase: 'bg-amber-50 text-amber-700' },
  APPROVED: { texto: 'Aprobada',            clase: 'bg-emerald-50 text-emerald-700' },
  REJECTED: { texto: 'Rechazada',           clase: 'bg-rose-50 text-rose-700' },
};

/**
 * Las solicitudes propias. Se muestra la nota del jefe solo cuando rechazó:
 * quien se quedó sin mover su feriado tiene que poder leer por qué sin
 * preguntar. Una aprobación no necesita defensa.
 */
function Historial({ solicitudes }: { solicitudes: SolicitudFeriado[] }) {
  if (solicitudes.length === 0) return null;
  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-gray-400">
        Tus solicitudes
      </p>
      <ul className="space-y-2">
        {solicitudes.map(s => {
          const e = ETIQUETA[s.status];
          return (
            <li key={s.id} className="text-[11px] text-gray-600">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate">
                  {/* El feriado pudo borrarse después de pedir el traslado: se
                      dice, en vez de dejar un guion que no explica nada. */}
                  {s.holidayName ?? 'Feriado que ya no existe'} → {fmtDateOnly(s.newDate)}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${e.clase}`}>
                  {e.texto}
                </span>
              </div>
              {s.status === 'REJECTED' && s.decisionNote && (
                <p className="mt-0.5 text-[10px] text-gray-500">Motivo: {s.decisionNote}</p>
              )}
              {s.sinRevisor && (
                /* Antes decía «no tenés jefe directo asignado», que para un
                   gerente general se lee como un dato faltante y no como un
                   hecho: no hay a quién pedírselo, y eso es correcto. */
                <p className="mt-0.5 text-[10px] text-gray-400">
                  Quedó aprobada directamente: estás en la cima del organigrama.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function monthBounds(dateIso: string): { min: string; max: string } {
  // Sin la `Z`: el navegador lo lee en hora local (medianoche local), no en
  // UTC. Con `Z` el mes se puede correr en los bordes -- p. ej. un feriado
  // guardado como "2026-09-01" se leería como 31 de agosto en zonas al oeste
  // de UTC, y los límites calculados serían los de agosto.
  const d = new Date(`${dateIso.slice(0, 10)}T00:00:00`);
  const y = d.getFullYear(), m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const p = (n: number) => String(n).padStart(2, '0');
  return { min: `${y}-${p(m + 1)}-01`, max: `${y}-${p(m + 1)}-${p(last)}` };
}
