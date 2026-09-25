import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TeamService } from './team.service';
import type { PluginContext } from '@vla/plugin-sdk';
import { aggregateSessions } from '../lib/timesheet';
import { DEFAULT_TZ } from '../lib/local-date';

/**
 * `TeamService` es el primer servicio de este plan que toca la base de
 * verdad: arma las filas del equipo con UNA consulta a `CheckInRecord` (no
 * una por persona) y las combina con la aritmética pura de `team-stats.ts` y
 * `timesheet.ts`, que ya están probadas por su cuenta. Lo que se prueba acá
 * es la orquestación: qué se le pasa a cada función pura, cómo se reparte la
 * única consulta por persona y por período, y que un fallo de esa consulta
 * degrade en vez de tumbar el proceso (Express 4 no atrapa un rechazo de
 * promesa en un handler async).
 */

const TZ = DEFAULT_TZ;
/** Instante UTC a partir de hora local de Costa Rica (UTC-6, sin horario de verano). */
const cr = (iso: string) => new Date(`${iso}-06:00`);

type CheckInRow = { userId: string; checkInAt: Date; checkOutAt: Date | null };
type UserRow = { id: string; firstName: string; lastName: string; email: string };

/**
 * Doble mínimo de `ctx`: `TeamService` solo toca `ctx.prisma.checkInRecord`,
 * `ctx.prisma.user` y `ctx.logger`. Mismo patrón que
 * `presence.service.test.ts` y `timesheet.service.test.ts` — no hace falta
 * simular Redis, hooks ni el resto de `PluginContext`.
 */
function makeCtx(opts: {
  checkIns?: CheckInRow[];
  users?: UserRow[];
  /** Si se da, el SELECT de CheckInRecord rechaza con este error. */
  rejectCheckIns?: Error;
  /** Si se da, el SELECT de usuarios rechaza con este error. */
  rejectUsers?: Error;
} = {}) {
  const warn = vi.fn();

  const checkInFindMany = vi.fn(async () => {
    if (opts.rejectCheckIns) throw opts.rejectCheckIns;
    return opts.checkIns ?? [];
  });
  const userFindMany = vi.fn(async () => {
    if (opts.rejectUsers) throw opts.rejectUsers;
    return opts.users ?? [];
  });

  const ctx = {
    prisma: {
      checkInRecord: { findMany: checkInFindMany },
      user: { findMany: userFindMany },
    },
    logger: { warn, log: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };

  return { ctx: ctx as unknown as PluginContext, warn, checkInFindMany, userFindMany };
}

function makeService(ctx: PluginContext, capHours = 12) {
  return new TeamService(ctx, () => TZ, () => capHours);
}

describe('TeamService.filas — sin-registrar nunca se ve como un cero real', () => {
  it('una persona sin ninguna sesión sale con estado sin-registrar Y totalMinutes 0', async () => {
    const { ctx } = makeCtx({
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const [fila] = await makeService(ctx).filas(['u1'], 'week', cr('2026-09-21T10:00:00'));

    // Las DOS afirmaciones a propósito: es la combinación exacta que la
    // interfaz necesita para no confundir "no hay dato" con "no hubo trabajo".
    expect(fila.estado).toBe('sin-registrar');
    expect(fila.totalMinutes).toBe(0);
  });

  it('una persona con sesiones sale con-registro y su total coincide con aggregateSessions', async () => {
    const within = { start: cr('2026-09-21T00:00:00'), end: cr('2026-09-21T23:59:59.999') };
    const sesion: CheckInRow = {
      userId: 'u1',
      checkInAt: cr('2026-09-21T08:00:00'),
      checkOutAt: cr('2026-09-21T12:30:00'),
    };
    const { ctx } = makeCtx({
      checkIns: [sesion],
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const [fila] = await makeService(ctx).filas(['u1'], 'day', cr('2026-09-21T10:00:00'));

    const esperado = aggregateSessions(
      [{ start: sesion.checkInAt, end: sesion.checkOutAt! }],
      within,
      TZ,
    ).totalMinutes;

    expect(fila.estado).toBe('con-registro');
    expect(fila.totalMinutes).toBe(esperado);
    expect(fila.totalMinutes).toBe(270);
  });
});

describe('TeamService.filas — la norma excluye el período actual', () => {
  it('tres días previos con actividad arman la norma; el día actual no la mueve', async () => {
    // Tres días previos con 60 minutos cada uno -> norma = 60, 3 períodos
    // usados. El día ACTUAL tiene 180 minutos: si se colara en la norma, el
    // promedio subiría a 75 y el porcentaje de variación cambiaría. La
    // prueba fija el número exacto para que un descuido así se note.
    const checkIns: CheckInRow[] = [
      { userId: 'u1', checkInAt: cr('2026-09-18T09:00:00'), checkOutAt: cr('2026-09-18T10:00:00') },
      { userId: 'u1', checkInAt: cr('2026-09-19T09:00:00'), checkOutAt: cr('2026-09-19T10:00:00') },
      { userId: 'u1', checkInAt: cr('2026-09-20T09:00:00'), checkOutAt: cr('2026-09-20T10:00:00') },
      { userId: 'u1', checkInAt: cr('2026-09-21T09:00:00'), checkOutAt: cr('2026-09-21T12:00:00') },
    ];
    const { ctx } = makeCtx({
      checkIns,
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const [fila] = await makeService(ctx).filas(['u1'], 'day', cr('2026-09-21T10:00:00'));

    expect(fila.totalMinutes).toBe(180);
    expect(fila.variacion).toEqual({ tipo: 'calculada', pct: 200, destacar: true });
  });
});

describe('TeamService.excepciones', () => {
  const AHORA = cr('2026-09-25T12:00:00');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
  });
  afterEach(() => vi.useRealTimers());

  it('una sesión abierta más vieja que la cota aparece con su fecha de inicio', async () => {
    const desde = cr('2026-09-20T08:00:00'); // 5 días antes, cota de 12h
    const { ctx } = makeCtx({
      checkIns: [{ userId: 'u1', checkInAt: desde, checkOutAt: null }],
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const { sesionesAbiertas } = await makeService(ctx, 12).excepciones(['u1']);

    expect(sesionesAbiertas).toEqual([{ userId: 'u1', nombre: 'Ana Pérez', desde: '2026-09-20' }]);
  });

  it('una sesión abierta más JOVEN que la cota no es una excepción', async () => {
    const desde = cr('2026-09-25T08:00:00'); // 4 horas antes, cota de 12h: normal
    const { ctx } = makeCtx({
      checkIns: [{ userId: 'u1', checkInAt: desde, checkOutAt: null }],
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const { sesionesAbiertas } = await makeService(ctx, 12).excepciones(['u1']);

    expect(sesionesAbiertas).toEqual([]);
  });

  it('quien no tiene ninguna marca en 30 días sale en sinMarcar30Dias', async () => {
    const { ctx } = makeCtx({
      checkIns: [],
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const { sinMarcar30Dias } = await makeService(ctx).excepciones(['u1']);

    expect(sinMarcar30Dias).toEqual([{ userId: 'u1', nombre: 'Ana Pérez' }]);
  });

  it('quien marcó hace poco NO sale en sinMarcar30Dias', async () => {
    const { ctx } = makeCtx({
      checkIns: [{ userId: 'u1', checkInAt: cr('2026-09-24T08:00:00'), checkOutAt: cr('2026-09-24T12:00:00') }],
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const { sinMarcar30Dias } = await makeService(ctx).excepciones(['u1']);

    expect(sinMarcar30Dias).toEqual([]);
  });
});

describe('TeamService.filas — degrada si la consulta de sesiones rechaza', () => {
  it('no lanza: devuelve filas sin-registrar y deja un warning', async () => {
    // NUNCA lanza: Express 4 no atrapa un rechazo de promesa en un handler
    // async, así que un fallo acá mataría el proceso entero del API, no solo
    // este endpoint.
    const { ctx, warn } = makeCtx({
      rejectCheckIns: new Error('relation "check_in_records" does not exist'),
      users: [
        { id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' },
        { id: 'u2', firstName: 'Beto', lastName: 'Solís', email: 'beto@vla.com' },
      ],
    });

    const filas = await makeService(ctx).filas(['u1', 'u2'], 'week', cr('2026-09-21T10:00:00'));

    expect(filas).toHaveLength(2);
    for (const fila of filas) {
      expect(fila.estado).toBe('sin-registrar');
      expect(fila.totalMinutes).toBe(0);
    }
    // diasHabiles no depende de la consulta que falló: sigue siendo el
    // calendario real, no un cero que se leería como "período vacío".
    expect(filas[0].diasHabiles).toBeGreaterThan(0);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('devuelve un arreglo vacío sin consultar nada si no hay userIds', async () => {
    const { ctx, checkInFindMany, userFindMany } = makeCtx();

    const filas = await makeService(ctx).filas([], 'week', cr('2026-09-21T10:00:00'));

    expect(filas).toEqual([]);
    expect(checkInFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
  });
});

describe('TeamService.filas — degrada si la consulta de nombres rechaza', () => {
  it('sigue calculando las sesiones con nombre vacío y deja un warning', async () => {
    const sesion: CheckInRow = {
      userId: 'u1',
      checkInAt: cr('2026-09-21T08:00:00'),
      checkOutAt: cr('2026-09-21T09:00:00'),
    };
    const { ctx, warn } = makeCtx({
      checkIns: [sesion],
      rejectUsers: new Error('pool agotado'),
    });

    const [fila] = await makeService(ctx).filas(['u1'], 'day', cr('2026-09-21T10:00:00'));

    // El nombre no se pudo leer, pero la sesión sí: no hay razón para que un
    // fallo en NOMBRES apague el cálculo de minutos de la persona.
    expect(fila.estado).toBe('con-registro');
    expect(fila.totalMinutes).toBe(60);
    expect(fila.firstName).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
