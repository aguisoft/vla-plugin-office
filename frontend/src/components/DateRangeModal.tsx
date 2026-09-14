import { useState } from 'react';
import { MIN_JUSTIFICATION, cfgOf } from '../statusConfig';
import { Shell, DateField, Actions, missingLabel } from './modalParts';

/**
 * Vacaciones e incapacidad comparten forma: rango de fechas completo.
 * Incapacidad además exige justificación, con el mismo mínimo que el resto
 * de los estados que la piden.
 */
export function DateRangeModal({ status, onClose, onConfirm }: {
  status: string;
  onClose: () => void;
  onConfirm: (startAt: string, endAt: string, justification?: string) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const cfg = cfgOf(status);
  const needsJustification = status === 'INCAPACIDAD';
  const missing = needsJustification ? Math.max(0, MIN_JUSTIFICATION - text.trim().length) : 0;
  const rangeInvalid = !!from && !!to && to < from;
  const invalid = !from || !to || rangeInvalid || missing > 0;

  // Extremos del día local: construir el Date sin la `Z` hace que el
  // navegador lo interprete en la zona local — medianoche local, no
  // medianoche UTC. Con `Z` la ausencia se corre y termina cubriendo el día
  // equivocado.
  const startIso = (d: string) => new Date(`${d}T00:00:00`).toISOString();
  const endIso   = (d: string) => new Date(`${d}T23:59:59.999`).toISOString();

  return (
    <Shell title={cfg.label} dot={cfg.dot} onClose={onClose}>
      <div className="flex items-center gap-2">
        <DateField label="Desde" value={from} onChange={setFrom} />
        <DateField label="Hasta" value={to} onChange={setTo} />
      </div>
      {rangeInvalid && (
        <p className="mt-2 text-xs text-red-500">La fecha de fin debe ser igual o posterior a la de inicio.</p>
      )}
      {needsJustification && (
        <textarea
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          rows={3}
          className="mt-3 w-full resize-none rounded-xl border border-gray-200 p-2.5 text-xs focus:border-gray-400 focus:outline-none"
          placeholder="Reposo médico por 5 días, adjunto la boleta de incapacidad"
        />
      )}
      <Actions
        onClose={onClose}
        disabled={invalid}
        confirmLabel={missing > 0 ? missingLabel(missing) : 'Confirmar'}
        onConfirm={() => onConfirm(startIso(from), endIso(to), needsJustification ? text.trim() : undefined)}
      />
    </Shell>
  );
}
