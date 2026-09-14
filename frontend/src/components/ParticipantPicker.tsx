import { useState } from 'react';
import { MIN_JUSTIFICATION, cfgOf } from '../statusConfig';
import { Shell, Actions, missingLabel } from './modalParts';
import { fmtDate } from '../format';
import type { UserSnapshot } from '../types';

/**
 * Selector de compañeros para "En reunión interna". Los ausentes salen
 * deshabilitados con el motivo al lado -- primera de las dos capas que evita
 * invitar a alguien que no está. El backend valida lo mismo sobre
 * `participantIds`, así que la regla no se puede saltar llamando la API
 * directo; esa segunda capa se muestra en `App.tsx` (alerta de `unavailable`).
 *
 * Se permite confirmar con cero seleccionados: es una reunión interna sin
 * registrar acompañantes, y el backend la acepta igual.
 */
export function ParticipantPicker({ users, currentUserId, onClose, onConfirm }: {
  users: UserSnapshot[];
  currentUserId: string;
  onClose: () => void;
  onConfirm: (ids: string[], justification: string) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const missing = Math.max(0, MIN_JUSTIFICATION - text.trim().length);

  const candidates = users.filter(u => u.userId !== currentUserId);

  return (
    <Shell title="En reunión interna" onClose={onClose}>
      <textarea
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        rows={2}
        placeholder="Seguimiento semanal del equipo de cobros"
        className="mb-3 w-full resize-none rounded-xl border border-gray-200 p-2.5 text-xs focus:border-gray-400 focus:outline-none"
      />
      <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-100">
        {candidates.map(u => {
          const cfg = cfgOf(u.status);
          const blocked = u.isAbsent;
          return (
            <label
              key={u.userId}
              className={`flex items-center gap-2.5 px-3 py-2 text-xs ${
                blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                disabled={blocked}
                checked={picked.has(u.userId)}
                onChange={e => {
                  const next = new Set(picked);
                  e.target.checked ? next.add(u.userId) : next.delete(u.userId);
                  setPicked(next);
                }}
              />
              <span className="text-gray-700">{u.firstName} {u.lastName}</span>
              {blocked && (
                <span className={`ml-auto ${cfg.text}`}>
                  {cfg.icon} {cfg.label}
                  {u.absenceEndsAt && ` hasta ${fmtDate(u.absenceEndsAt)}`}
                </span>
              )}
            </label>
          );
        })}
      </div>
      <Actions
        onClose={onClose}
        disabled={missing > 0}
        confirmLabel={missing > 0 ? missingLabel(missing) : `Invitar a ${picked.size}`}
        onConfirm={() => onConfirm([...picked], text.trim())}
      />
    </Shell>
  );
}
