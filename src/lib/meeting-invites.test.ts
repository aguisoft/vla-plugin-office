import { describe, it, expect } from 'vitest';
import { nextInviteState, isExpired, INVITE_TTL_MS } from './meeting-invites';

const created = new Date('2026-09-14T18:00:00Z');
const soon    = new Date(created.getTime() + 60_000);
const late    = new Date(created.getTime() + INVITE_TTL_MS + 1);

describe('isExpired', () => {
  it('false dentro de la ventana', () => {
    expect(isExpired(created, soon)).toBe(false);
  });

  it('false exactamente en el límite', () => {
    expect(isExpired(created, new Date(created.getTime() + INVITE_TTL_MS))).toBe(false);
  });

  it('true pasado el límite', () => {
    expect(isExpired(created, late)).toBe(true);
  });
});

describe('nextInviteState', () => {
  it('aceptar una pendiente a tiempo', () => {
    expect(nextInviteState('PENDING', 'accept', created, soon)).toEqual({ state: 'ACCEPTED' });
  });

  it('rechazar una pendiente', () => {
    expect(nextInviteState('PENDING', 'decline', created, soon)).toEqual({ state: 'DECLINED' });
  });

  it('cancelar una pendiente', () => {
    expect(nextInviteState('PENDING', 'cancel', created, soon)).toEqual({ state: 'CANCELLED' });
  });

  it('aceptar una vencida la marca EXPIRED y da error', () => {
    const r = nextInviteState('PENDING', 'accept', created, late);
    expect(r).toEqual({ error: 'expired' });
  });

  it('rechazar una vencida también falla', () => {
    expect(nextInviteState('PENDING', 'decline', created, late)).toEqual({ error: 'expired' });
  });

  it('cancelar una vencida sí se permite: es limpieza del host', () => {
    expect(nextInviteState('PENDING', 'cancel', created, late)).toEqual({ state: 'CANCELLED' });
  });

  it('no se puede aceptar dos veces', () => {
    expect(nextInviteState('ACCEPTED', 'accept', created, soon)).toEqual({ error: 'not_pending' });
  });

  it('no se puede aceptar una rechazada', () => {
    expect(nextInviteState('DECLINED', 'accept', created, soon)).toEqual({ error: 'not_pending' });
  });

  it('el host sí puede cancelar una aceptada: termina la reunión', () => {
    expect(nextInviteState('ACCEPTED', 'cancel', created, soon)).toEqual({ state: 'CANCELLED' });
  });

  it('no se puede cancelar una ya cancelada', () => {
    expect(nextInviteState('CANCELLED', 'cancel', created, soon)).toEqual({ error: 'not_pending' });
  });
});
