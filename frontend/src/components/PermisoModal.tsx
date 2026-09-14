import { useState } from 'react';
import { MIN_JUSTIFICATION } from '../statusConfig';
import { Shell, DateField, TimeField, Actions } from './modalParts';

/**
 * Permiso es una ausencia corta dentro de un mismo día: fecha + rango de
 * hora, más justificación obligatoria. Los dos instantes se arman sobre esa
 * misma fecha, así que el backend nunca recibe un permiso que cruce de día.
 */
export function PermisoModal({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (startAt: string, endAt: string, justification: string) => void;
}) {
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('10:00');
  const [text, setText] = useState('');
  const missing = Math.max(0, MIN_JUSTIFICATION - text.trim().length);
  const timeInvalid = to <= from;
  const invalid = !date || timeInvalid || missing > 0;

  const toIso = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(`${date}T00:00:00`);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };

  return (
    <Shell title="Permiso" onClose={onClose}>
      <DateField label="Fecha" value={date} onChange={setDate} />
      <div className="mt-3 flex items-center gap-2">
        <TimeField label="Desde" value={from} onChange={setFrom} />
        <TimeField label="Hasta" value={to} onChange={setTo} />
      </div>
      {timeInvalid && <p className="mt-2 text-xs text-red-500">La hora de fin debe ser posterior.</p>}
      <textarea
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        className="mt-3 w-full resize-none rounded-xl border border-gray-200 p-2.5 text-xs focus:border-gray-400 focus:outline-none"
        placeholder="Trámite médico en la tarde"
      />
      <Actions
        onClose={onClose}
        disabled={invalid}
        confirmLabel={missing > 0 ? `Faltan ${missing} caracteres` : 'Confirmar'}
        onConfirm={() => onConfirm(toIso(from), toIso(to), text.trim())}
      />
    </Shell>
  );
}
