import { describe, it, expect } from 'vitest';
import { absenceBounds, dateOnlyAnchor } from './absence-bounds';
import { DEFAULT_TZ } from './local-date';

const TZ = DEFAULT_TZ; // America/Costa_Rica

describe('absenceBounds — VACACIONES/INCAPACIDAD (día completo, fecha pura)', () => {
  it('15 al 18 de septiembre -> 00:00:00 del 15 a 23:59:59.999 del 18, hora CR, en UTC', () => {
    const { startAt, endAt } = absenceBounds('VACACIONES', '2026-09-15', '2026-09-18', TZ);
    expect(startAt.toISOString()).toBe('2026-09-15T06:00:00.000Z'); // 15 sept 00:00:00 CR
    expect(endAt.toISOString()).toBe('2026-09-19T05:59:59.999Z');   // 18 sept 23:59:59.999 CR
  });

  it('INCAPACIDAD normaliza exactamente igual que VACACIONES', () => {
    const { startAt, endAt } = absenceBounds('INCAPACIDAD', '2026-09-15', '2026-09-18', TZ);
    expect(startAt.toISOString()).toBe('2026-09-15T06:00:00.000Z');
    expect(endAt.toISOString()).toBe('2026-09-19T05:59:59.999Z');
  });

  it('un solo día (15 al 15): el mismo string en los dos campos sigue dando 24h completas', () => {
    const { startAt, endAt } = absenceBounds('VACACIONES', '2026-09-15', '2026-09-15', TZ);
    expect(startAt.toISOString()).toBe('2026-09-15T06:00:00.000Z');
    expect(endAt.toISOString()).toBe('2026-09-16T05:59:59.999Z');
  });

  it('cruce de fin de mes/año (31 dic al 1 ene)', () => {
    const { startAt, endAt } = absenceBounds('VACACIONES', '2026-12-31', '2027-01-01', TZ);
    expect(startAt.toISOString()).toBe('2026-12-31T06:00:00.000Z');
    expect(endAt.toISOString()).toBe('2027-01-02T05:59:59.999Z');
  });
});

describe('absenceBounds — PERMISO (instante real, sin normalizar)', () => {
  it('devuelve startAt/endAt tal cual, sin tocarlos', () => {
    const { startAt, endAt } = absenceBounds(
      'PERMISO', '2026-09-15T14:00:00.000Z', '2026-09-15T16:30:00.000Z', TZ,
    );
    expect(startAt.toISOString()).toBe('2026-09-15T14:00:00.000Z');
    expect(endAt.toISOString()).toBe('2026-09-15T16:30:00.000Z');
  });
});

describe('dateOnlyAnchor', () => {
  it('toma solo la fecha de una fecha pura ("YYYY-MM-DD"), el caso normal del contrato', () => {
    expect(dateOnlyAnchor('2026-09-15').toISOString()).toBe('2026-09-15T12:00:00.000Z');
  });

  it('toma solo la fecha aunque llegue un datetime completo (red de seguridad, no el camino normal)', () => {
    // No es el contrato -- DateRangeModal manda fecha pura -- pero si algo
    // más mandara un instante completo, dateOnlyAnchor no debe leer su hora.
    expect(dateOnlyAnchor('2026-09-15T23:00:00.000Z').toISOString()).toBe('2026-09-15T12:00:00.000Z');
    expect(dateOnlyAnchor('2026-09-15T00:00:00.000Z').toISOString()).toBe('2026-09-15T12:00:00.000Z');
  });
});
