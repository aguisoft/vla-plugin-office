import { describe, it, expect } from 'vitest';
import { periodBounds, clipSpan, splitByLocalDay, spanMinutes, aggregateSessions, resolveScope, canSee } from './timesheet';
import { DEFAULT_TZ } from './local-date';

const TZ = DEFAULT_TZ;
/** Instante UTC a partir de hora local de Costa Rica (UTC-6, sin horario de verano). */
const cr = (iso: string) => new Date(`${iso}-06:00`);

describe('periodBounds', () => {
  it('day va de 00:00:00 a 23:59:59.999 locales', () => {
    const { start, end } = periodBounds(cr('2026-09-22T15:30:00'), 'day', TZ);
    expect(start.toISOString()).toBe('2026-09-22T06:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-23T05:59:59.999Z');
  });

  it('week arranca lunes y termina domingo', () => {
    // 2026-09-22 es martes; la semana va del lunes 21 al domingo 27.
    const { start, end } = periodBounds(cr('2026-09-22T15:30:00'), 'week', TZ);
    expect(start.toISOString()).toBe('2026-09-21T06:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-28T05:59:59.999Z');
  });

  it('week con ancla en domingo NO salta a la semana siguiente', () => {
    const { start } = periodBounds(cr('2026-09-27T10:00:00'), 'week', TZ);
    expect(start.toISOString()).toBe('2026-09-21T06:00:00.000Z');
  });

  it('month cubre el mes local completo', () => {
    const { start, end } = periodBounds(cr('2026-09-22T15:30:00'), 'month', TZ);
    expect(start.toISOString()).toBe('2026-09-01T06:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-01T05:59:59.999Z');
  });

  it('month de enero no retrocede a diciembre', () => {
    const { start } = periodBounds(cr('2026-01-15T10:00:00'), 'month', TZ);
    expect(start.toISOString()).toBe('2026-01-01T06:00:00.000Z');
  });
});

describe('clipSpan', () => {
  const within = { start: cr('2026-09-22T00:00:00'), end: cr('2026-09-22T23:59:59') };

  it('un span contenido queda igual', () => {
    const s = { start: cr('2026-09-22T09:00:00'), end: cr('2026-09-22T11:00:00') };
    expect(clipSpan(s, within)).toEqual(s);
  });

  it('un span que empieza antes y termina despues cubre el rango completo', () => {
    const s = { start: cr('2026-09-21T09:00:00'), end: cr('2026-09-23T11:00:00') };
    expect(clipSpan(s, within)).toEqual(within);
  });

  it('un span enteramente fuera devuelve null', () => {
    const s = { start: cr('2026-09-25T09:00:00'), end: cr('2026-09-25T11:00:00') };
    expect(clipSpan(s, within)).toBeNull();
  });

  it('un span que apenas toca el borde devuelve null y no un rango de cero', () => {
    const s = { start: within.end, end: cr('2026-09-23T10:00:00') };
    expect(clipSpan(s, within)).toBeNull();
  });
});

describe('splitByLocalDay', () => {
  it('un span dentro de un dia da un solo tramo', () => {
    const out = splitByLocalDay({ start: cr('2026-09-22T09:00:00'), end: cr('2026-09-22T11:30:00') }, TZ);
    expect(out).toEqual([{ date: '2026-09-22', minutes: 150 }]);
  });

  it('un span que cruza medianoche se parte en dos dias', () => {
    const out = splitByLocalDay({ start: cr('2026-09-22T23:00:00'), end: cr('2026-09-23T01:00:00') }, TZ);
    expect(out).toEqual([
      { date: '2026-09-22', minutes: 60 },
      { date: '2026-09-23', minutes: 60 },
    ]);
  });

  it('un span de tres dias da tres tramos con el del medio completo', () => {
    const out = splitByLocalDay({ start: cr('2026-09-21T22:00:00'), end: cr('2026-09-23T02:00:00') }, TZ);
    expect(out.map(x => x.date)).toEqual(['2026-09-21', '2026-09-22', '2026-09-23']);
    expect(out[1].minutes).toBe(1440);
  });

  it('cruce de fin de mes: 30 de septiembre a 1 de octubre', () => {
    const out = splitByLocalDay({ start: cr('2026-09-30T23:30:00'), end: cr('2026-10-01T00:30:00') }, TZ);
    expect(out).toEqual([
      { date: '2026-09-30', minutes: 30 },
      { date: '2026-10-01', minutes: 30 },
    ]);
  });
});

describe('spanMinutes', () => {
  it('redondea al minuto mas cercano', () => {
    expect(spanMinutes({ start: cr('2026-09-22T09:00:00'), end: cr('2026-09-22T09:00:29') })).toBe(0);
    expect(spanMinutes({ start: cr('2026-09-22T09:00:00'), end: cr('2026-09-22T09:00:31') })).toBe(1);
  });

  it('un span invertido da cero, no negativo', () => {
    expect(spanMinutes({ start: cr('2026-09-22T11:00:00'), end: cr('2026-09-22T09:00:00') })).toBe(0);
  });
});

describe('aggregateSessions', () => {
  const within = { start: cr('2026-09-21T00:00:00'), end: cr('2026-09-27T23:59:59') };

  it('suma sesiones cerradas por dia', () => {
    const out = aggregateSessions([
      { start: cr('2026-09-21T08:00:00'), end: cr('2026-09-21T12:00:00') },
      { start: cr('2026-09-21T13:00:00'), end: cr('2026-09-21T17:00:00') },
      { start: cr('2026-09-22T08:00:00'), end: cr('2026-09-22T16:00:00') },
    ], within, TZ);
    expect(out.totalMinutes).toBe(480 + 480);
    expect(out.byDay).toEqual([
      { date: '2026-09-21', minutes: 480 },
      { date: '2026-09-22', minutes: 480 },
    ]);
  });

  it('recorta una sesion que empieza antes del periodo', () => {
    const out = aggregateSessions(
      [{ start: cr('2026-09-20T22:00:00'), end: cr('2026-09-21T02:00:00') }],
      within, TZ,
    );
    expect(out.totalMinutes).toBe(120);
    expect(out.byDay).toEqual([{ date: '2026-09-21', minutes: 120 }]);
  });

  it('descarta sesiones enteramente fuera del periodo', () => {
    const out = aggregateSessions(
      [{ start: cr('2026-09-10T08:00:00'), end: cr('2026-09-10T17:00:00') }],
      within, TZ,
    );
    expect(out.totalMinutes).toBe(0);
    expect(out.byDay).toEqual([]);
  });

  it('una sesion que cruza medianoche aporta a los dos dias', () => {
    const out = aggregateSessions(
      [{ start: cr('2026-09-22T22:00:00'), end: cr('2026-09-23T02:00:00') }],
      within, TZ,
    );
    expect(out.byDay).toEqual([
      { date: '2026-09-22', minutes: 120 },
      { date: '2026-09-23', minutes: 120 },
    ]);
  });

  it('los dias salen ordenados aunque las sesiones lleguen desordenadas', () => {
    const out = aggregateSessions([
      { start: cr('2026-09-23T08:00:00'), end: cr('2026-09-23T09:00:00') },
      { start: cr('2026-09-21T08:00:00'), end: cr('2026-09-21T09:00:00') },
    ], within, TZ);
    expect(out.byDay.map(d => d.date)).toEqual(['2026-09-21', '2026-09-23']);
  });
});

describe('resolveScope', () => {
  const managed = new Set(['b', 'c']);

  it('uno mismo esta incluido', () => {
    expect(resolveScope('a', managed, false).has('a')).toBe(true);
  });

  it('un jefe ve a sus directos', () => {
    const s = resolveScope('a', managed, false);
    expect([...s].sort()).toEqual(['a', 'b', 'c']);
  });

  it('quien no tiene gente a cargo solo se ve a si mismo', () => {
    expect([...resolveScope('z', new Set(), false)]).toEqual(['z']);
  });

  it('ADMIN devuelve null, que significa "sin restriccion"', () => {
    expect(resolveScope('a', managed, true)).toBeNull();
  });
});

describe('canSee', () => {
  it('ADMIN ve a cualquiera', () => {
    expect(canSee(null, 'quien-sea')).toBe(true);
  });

  it('fuera del conjunto es false', () => {
    expect(canSee(new Set(['a', 'b']), 'z')).toBe(false);
  });

  it('dentro del conjunto es true', () => {
    expect(canSee(new Set(['a', 'b']), 'b')).toBe(true);
  });
});
