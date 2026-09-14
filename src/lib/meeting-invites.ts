export type InviteState = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
export type InviteAction = 'accept' | 'decline' | 'cancel';

export const INVITE_TTL_MS = 15 * 60 * 1000;

export function isExpired(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > INVITE_TTL_MS;
}

export type InviteTransition = { state: InviteState } | { error: string };

/**
 * Transición válida de una invitación.
 *
 * `cancel` es la acción del host, no del invitado, así que se permite sobre una
 * invitación ACCEPTED (el host cambió de estado y la reunión terminó) y también
 * sobre una PENDING ya vencida (limpieza). `accept` y `decline` son del invitado
 * y solo aplican a una PENDING dentro de la ventana.
 */
export function nextInviteState(
  current: InviteState,
  action: InviteAction,
  createdAt: Date,
  now: Date,
): InviteTransition {
  if (action === 'cancel') {
    if (current === 'PENDING' || current === 'ACCEPTED') return { state: 'CANCELLED' };
    return { error: 'not_pending' };
  }

  if (current !== 'PENDING') return { error: 'not_pending' };
  if (isExpired(createdAt, now)) return { error: 'expired' };

  return { state: action === 'accept' ? 'ACCEPTED' : 'DECLINED' };
}
