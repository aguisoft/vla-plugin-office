import { useState } from 'react';
import { MIN_JUSTIFICATION, cfgOf } from '../statusConfig';
import { Shell, Actions, missingLabel } from './modalParts';

/** Usado por FOCUS, IN_MEETING_EXTERNAL y BRB: un solo textarea de respaldo. */
export function JustificationModal({ status, onClose, onConfirm }: {
  status: string;
  onClose: () => void;
  onConfirm: (justification: string) => void;
}) {
  const [text, setText] = useState('');
  const missing = Math.max(0, MIN_JUSTIFICATION - text.trim().length);
  const cfg = cfgOf(status);

  return (
    <Shell title={cfg.label} dot={cfg.dot} onClose={onClose}>
      <p className="mb-3 text-xs text-gray-500">
        Escribí qué respalda este estado. Tus compañeros lo van a ver.
      </p>
      <textarea
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
        className="w-full resize-none rounded-xl border border-gray-200 p-2.5 text-xs focus:border-gray-400 focus:outline-none"
        placeholder="Cerrando el reporte de cobros de septiembre"
      />
      <Actions
        onClose={onClose}
        disabled={missing > 0}
        confirmLabel={missing > 0 ? missingLabel(missing) : 'Confirmar'}
        onConfirm={() => onConfirm(text.trim())}
      />
    </Shell>
  );
}
