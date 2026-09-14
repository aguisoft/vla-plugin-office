import { useState } from 'react';
import { Shell } from './modalParts';
import { fmtTime } from '../format';
import type { PendingInvite } from '../types';

/**
 * Invitación entrante a una reunión interna. El estado de quien la recibe
 * cambia solo si acepta -- cerrar el modal (clic afuera, vía `Shell`) cuenta
 * como Rechazar, nunca como aceptar en silencio.
 */
export function MeetingInviteModal({ invite, onRespond }: {
  invite: PendingInvite;
  onRespond: (id: string, action: 'accept' | 'decline') => void;
}) {
  // Guarda de doble clic: sin esto, un clic rápido en los dos botones dispara
  // las dos acciones antes de que `invites` se actualice del lado de App.tsx.
  // Se guarda el id de la invitación, no un booleano suelto, porque esta
  // misma instancia se reutiliza sin `key` para la siguiente de la cola --
  // guardar el id hace que esa siguiente invitación arranque sin bloquear.
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const responding = respondingId === invite.id;

  const respond = (action: 'accept' | 'decline') => {
    if (responding) return;
    setRespondingId(invite.id);
    onRespond(invite.id, action);
  };

  return (
    <Shell title="Te invitaron a una reunión" onClose={() => respond('decline')}>
      <p className="text-xs text-gray-700">
        <span className="font-semibold">{invite.hostName}</span> te invitó a una reunión interna.
      </p>
      {invite.justification && (
        <p className="mt-2 rounded-xl bg-gray-50 p-2.5 text-xs text-gray-600">
          {invite.justification}
        </p>
      )}
      <p className="mt-2 text-[10px] text-gray-400">
        Vence a las {fmtTime(invite.expiresAt)}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={() => respond('decline')}
          disabled={responding}
          className="rounded-xl px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Rechazar
        </button>
        <button
          onClick={() => respond('accept')}
          disabled={responding}
          className="rounded-xl bg-gray-800 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Aceptar
        </button>
      </div>
    </Shell>
  );
}
