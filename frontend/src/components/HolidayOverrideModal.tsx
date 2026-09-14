import { useEffect, useState } from 'react';
import { listMovableHolidays } from '../api';
import { MIN_JUSTIFICATION } from '../statusConfig';
import { fmtDate, monthName } from '../format';
import { Shell, DateField, Actions, missingLabel } from './modalParts';
import type { Holiday } from '../types';

/**
 * El colaborador mueve un feriado que le corresponde a otra fecha del mismo
 * mes (p. ej. trabajar el 15 por cierre de mes y tomarlo el 25). El backend
 * exige que la fecha nueva caiga en el mismo mes que el feriado original;
 * `monthBounds` acota el `<input type="date">` a eso para que el 400 del
 * backend quede como red y no como la única defensa.
 */
export function HolidayOverrideModal({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (holidayId: string, newDate: string, justification: string) => void;
}) {
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [holidayId, setHolidayId] = useState('');
  const [newDate, setNewDate] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    // Sin `.catch`, un 401/500 acá queda como rejection sin manejar. Si la
    // carga falla, el modal cae en el mismo estado vacío que "no hay
    // feriados" -- no hay nada mejor que mostrar de todas formas.
    void listMovableHolidays().then(setHolidays).catch(() => setHolidays([]));
  }, []);

  const chosen = holidays?.find(h => h.id === holidayId);
  // Mismo mes que el feriado: el backend exige exactamente esto.
  const bounds = chosen ? monthBounds(chosen.date) : null;
  const missing = Math.max(0, MIN_JUSTIFICATION - text.trim().length);
  const ready = !!chosen && !!newDate && missing === 0;

  if (holidays && holidays.length === 0) {
    // Dos causas distintas para la misma lista vacía -- ya movió todos los
    // feriados de su país, o RRHH todavía no cargó el calendario -- y no hay
    // forma de distinguirlas desde acá sin agregar una llamada nueva que este
    // modal (que usa cualquier colaborador) puede no tener permiso de hacer.
    return (
      <Shell title="Feriado" onClose={onClose}>
        <p className="text-xs text-gray-500">
          No hay feriados disponibles para mover. Ya moviste todos los de tu país,
          o RRHH todavía no cargó el calendario.
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Mover un feriado" onClose={onClose}>
      <select
        value={holidayId}
        onChange={e => { setHolidayId(e.target.value); setNewDate(''); }}
        className="mb-3 w-full rounded-xl border border-gray-200 p-2 text-xs"
      >
        <option value="">Elegí el feriado…</option>
        {holidays?.map(h => (
          <option key={h.id} value={h.id}>{h.name} — {fmtDate(h.date)}</option>
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
        confirmLabel={missing > 0 ? missingLabel(missing) : 'Confirmar'}
        onConfirm={() => onConfirm(holidayId, newDate, text.trim())}
      />
    </Shell>
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
