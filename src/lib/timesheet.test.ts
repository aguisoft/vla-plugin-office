import { describe, it, expect } from 'vitest';
import { periodBounds, clipSpan, splitByLocalDay, spanMinutes, aggregateSessions, resolveScope, canSee, aggregateIntervals, reconcile, tallyAbsences } from './timesheet';
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

describe('aggregateIntervals', () => {
  const within = { start: cr('2026-09-22T00:00:00'), end: cr('2026-09-22T23:59:59') };

  it('suma por estado y descarta OFFLINE', () => {
    const out = aggregateIntervals([
      { status: 'AVAILABLE', start: cr('2026-09-22T08:00:00'), end: cr('2026-09-22T10:00:00') },
      { status: 'FOCUS',     start: cr('2026-09-22T10:00:00'), end: cr('2026-09-22T12:00:00') },
      { status: 'AVAILABLE', start: cr('2026-09-22T13:00:00'), end: cr('2026-09-22T14:00:00') },
      { status: 'OFFLINE',   start: cr('2026-09-22T18:00:00'), end: cr('2026-09-22T23:00:00') },
    ], within, TZ);
    expect(out).toEqual([
      { status: 'AVAILABLE', minutes: 180 },
      { status: 'FOCUS', minutes: 120 },
    ]);
  });

  it('recorta contra el periodo', () => {
    const out = aggregateIntervals(
      [{ status: 'FOCUS', start: cr('2026-09-21T22:00:00'), end: cr('2026-09-22T02:00:00') }],
      within, TZ,
    );
    expect(out).toEqual([{ status: 'FOCUS', minutes: 120 }]);
  });

  it('ordena de mayor a menor', () => {
    const out = aggregateIntervals([
      { status: 'BRB',   start: cr('2026-09-22T08:00:00'), end: cr('2026-09-22T08:30:00') },
      { status: 'FOCUS', start: cr('2026-09-22T09:00:00'), end: cr('2026-09-22T12:00:00') },
    ], within, TZ);
    expect(out.map(s => s.status)).toEqual(['FOCUS', 'BRB']);
  });

  it('sin intervalos devuelve lista vacia', () => {
    expect(aggregateIntervals([], within, TZ)).toEqual([]);
  });
});

describe('reconcile', () => {
  it('la diferencia sale como sin registrar', () => {
    const out = reconcile(480, [{ status: 'FOCUS', minutes: 300 }]);
    expect(out.unaccountedMinutes).toBe(180);
  });

  it('cuando cuadra, sin registrar es cero', () => {
    const out = reconcile(300, [{ status: 'FOCUS', minutes: 300 }]);
    expect(out.unaccountedMinutes).toBe(0);
  });

  it('si los tramos superan el tiempo conectado, se recortan proporcionalmente', () => {
    // Puede pasar si alguien quedo con estado activo fuera de una sesion de
    // oficina. Mostrar mas tiempo en estados que conectado seria absurdo.
    const out = reconcile(100, [
      { status: 'FOCUS', minutes: 150 },
      { status: 'AVAILABLE', minutes: 50 },
    ]);
    expect(out.unaccountedMinutes).toBe(0);
    expect(out.slices.reduce((a, s) => a + s.minutes, 0)).toBe(100);
    expect(out.slices[0].minutes).toBe(75);
  });

  it('tiempo conectado cero deja todo en cero', () => {
    const out = reconcile(0, [{ status: 'FOCUS', minutes: 60 }]);
    expect(out.slices.every(s => s.minutes === 0)).toBe(true);
    expect(out.unaccountedMinutes).toBe(0);
  });
});

describe('tallyAbsences', () => {
  const semana = { start: cr('2026-09-21T00:00:00'), end: cr('2026-09-27T23:59:59') };

  it('VACACIONES de 3 dias da 3 dias y 24 horas con jornada de 8', () => {
    const out = tallyAbsences([
      { type: 'VACACIONES', startAt: cr('2026-09-21T00:00:00'), endAt: cr('2026-09-23T23:59:59') },
    ], semana, 8, TZ);
    expect(out).toEqual([{ type: 'VACACIONES', days: 3, minutes: 3 * 8 * 60 }]);
  });

  it('PERMISO usa su duracion real, no la jornada completa', () => {
    // Un permiso de 2 horas no puede contar como un dia entero.
    const out = tallyAbsences([
      { type: 'PERMISO', startAt: cr('2026-09-22T14:00:00'), endAt: cr('2026-09-22T16:00:00') },
    ], semana, 8, TZ);
    expect(out).toEqual([{ type: 'PERMISO', days: 0, minutes: 120 }]);
  });

  it('recorta una ausencia que empieza antes del periodo', () => {
    const out = tallyAbsences([
      { type: 'INCAPACIDAD', startAt: cr('2026-09-19T00:00:00'), endAt: cr('2026-09-22T23:59:59') },
    ], semana, 8, TZ);
    expect(out[0].days).toBe(2); // solo lunes 21 y martes 22
  });

  it('descarta ausencias enteramente fuera del periodo', () => {
    const out = tallyAbsences([
      { type: 'VACACIONES', startAt: cr('2026-08-01T00:00:00'), endAt: cr('2026-08-05T23:59:59') },
    ], semana, 8, TZ);
    expect(out).toEqual([]);
  });

  it('agrupa varias del mismo tipo', () => {
    const out = tallyAbsences([
      { type: 'PERMISO', startAt: cr('2026-09-21T09:00:00'), endAt: cr('2026-09-21T10:00:00') },
      { type: 'PERMISO', startAt: cr('2026-09-23T09:00:00'), endAt: cr('2026-09-23T11:00:00') },
    ], semana, 8, TZ);
    expect(out).toEqual([{ type: 'PERMISO', days: 0, minutes: 180 }]);
  });

  it('una jornada distinta cambia las horas pero no los dias', () => {
    const out = tallyAbsences([
      { type: 'VACACIONES', startAt: cr('2026-09-21T00:00:00'), endAt: cr('2026-09-22T23:59:59') },
    ], semana, 6, TZ);
    expect(out).toEqual([{ type: 'VACACIONES', days: 2, minutes: 2 * 6 * 60 }]);
  });

  it('dos tipos distintos en el mismo periodo dan dos entradas', () => {
    const out = tallyAbsences([
      { type: 'VACACIONES', startAt: cr('2026-09-21T00:00:00'), endAt: cr('2026-09-21T23:59:59') },
      { type: 'PERMISO', startAt: cr('2026-09-22T09:00:00'), endAt: cr('2026-09-22T10:00:00') },
    ], semana, 8, TZ);
    expect(out.map(t => t.type)).toEqual(['VACACIONES', 'PERMISO']);
  });

  it('sin ausencias devuelve lista vacia', () => {
    expect(tallyAbsences([], semana, 8, TZ)).toEqual([]);
  });
});
