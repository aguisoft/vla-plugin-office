import { useState } from 'react';
import { Shell, TimeField, Actions } from './modalParts';

/** Único estado con payload `timeRange`: Almuerzo. */
export function TimeRangeModal({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (startsAt: string, endsAt: string) => void;
}) {
  const [from, setFrom] = useState('12:00');
  const [to, setTo] = useState('13:00');
  const invalid = to <= from;

  // Construido sobre el día de hoy del navegador — que corre en la zona del
  // colaborador, así que no hay corrimiento.
  const toIso = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };

  return (
    <Shell title="Almuerzo" onClose={onClose}>
      <div className="flex items-center gap-2">
        <TimeField label="Desde" value={from} onChange={setFrom} />
        <TimeField label="Hasta" value={to} onChange={setTo} />
      </div>
      {invalid && <p className="mt-2 text-xs text-red-500">La hora de fin debe ser posterior.</p>}
      <Actions
        onClose={onClose}
        disabled={invalid}
        onConfirm={() => onConfirm(toIso(from), toIso(to))}
      />
    </Shell>
  );
}
