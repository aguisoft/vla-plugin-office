import { describe, it, expect } from 'vitest';
import {
  localDateString,
  localDayStart,
  localDayEnd,
  sameLocalMonth,
  zonedTimeToUtc,
  DEFAULT_TZ,
} from './local-date';

const TZ = DEFAULT_TZ; // America/Costa_Rica, UTC-6 sin horario de verano

describe('localDateString', () => {
  it('da el día local, no el de UTC, después de las 18:00', () => {
    // 2026-09-15T02:30:00Z son las 20:30 del 14 en Costa Rica
    expect(localDateString(new Date('2026-09-15T02:30:00Z'), TZ)).toBe('2026-09-14');
  });

  it('coincide con UTC durante la mañana local', () => {
    expect(localDateString(new Date('2026-09-14T15:00:00Z'), TZ)).toBe('2026-09-14');
  });

  it('cruza al día siguiente a partir de las 06:00Z', () => {
    // 06:00Z es medianoche local, ya es día nuevo
    expect(localDateString(new Date('2026-09-14T06:00:00Z'), TZ)).toBe('2026-09-14');
    expect(localDateString(new Date('2026-09-14T05:59:59Z'), TZ)).toBe('2026-09-13');
  });
});

describe('localDayStart / localDayEnd', () => {
  it('medianoche local del 14 es 06:00Z del 14', () => {
    const start = localDayStart(new Date('2026-09-14T20:00:00Z'), TZ);
    expect(start.toISOString()).toBe('2026-09-14T06:00:00.000Z');
  });

  it('el fin del día local es 05:59:59.999Z del día siguiente', () => {
    const end = localDayEnd(new Date('2026-09-14T20:00:00Z'), TZ);
    expect(end.toISOString()).toBe('2026-09-15T05:59:59.999Z');
  });

  it('un instante de las 23:30 local cae dentro de su propio día', () => {
    const instant = new Date('2026-09-15T05:30:00Z'); // 23:30 del 14 local
    const start = localDayStart(instant, TZ);
    const end = localDayEnd(instant, TZ);
    expect(instant >= start && instant <= end).toBe(true);
    expect(localDateString(start, TZ)).toBe('2026-09-14');
  });
});

describe('sameLocalMonth', () => {
  it('true para dos fechas del mismo mes local', () => {
    expect(sameLocalMonth(
      new Date('2026-09-01T18:00:00Z'),
      new Date('2026-09-30T18:00:00Z'),
      TZ,
    )).toBe(true);
  });

  it('false cruzando de mes', () => {
    expect(sameLocalMonth(
      new Date('2026-09-30T18:00:00Z'),
      new Date('2026-10-01T18:00:00Z'),
      TZ,
    )).toBe(false);
  });

  it('usa el mes local, no el de UTC, en el borde del mes', () => {
    // 2026-10-01T03:00:00Z son las 21:00 del 30 de septiembre en Costa Rica
    expect(sameLocalMonth(
      new Date('2026-09-15T18:00:00Z'),
      new Date('2026-10-01T03:00:00Z'),
      TZ,
    )).toBe(true);
  });
});

describe('zonedTimeToUtc', () => {
  it('convierte una hora local a su instante UTC', () => {
    expect(zonedTimeToUtc(2026, 9, 14, 12, 0, 0, TZ).toISOString())
      .toBe('2026-09-14T18:00:00.000Z');
  });

  it('medianoche local', () => {
    expect(zonedTimeToUtc(2026, 9, 14, 0, 0, 0, TZ).toISOString())
      .toBe('2026-09-14T06:00:00.000Z');
  });
});
