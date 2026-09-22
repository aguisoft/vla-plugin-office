import { describe, it, expect, vi } from 'vitest';
import { TimesheetService } from './timesheet.service';
import type { AbsenceService } from './absence.service';
import type { PluginContext } from '@vla/plugin-sdk';
import { DEFAULT_TZ } from '../lib/local-date';

/**
 * Lo que se prueba acá es la decisión del servicio, no la aritmética: esa ya
 * vive en `src/lib/timesheet.ts` con sus propias pruebas puras.
 *
 * `capOpenSession` tenía cuatro pruebas para dos líneas triviales, y la lógica
 * que de verdad cambia números —aplicar la cota SOLO a la sesión sin salida,
 * contar cuántas se acotaron, propagar `openSessionCapHours`— no tenía
 * ninguna. Lo mismo con el `null` de `statusBreakdown` y `coverageStart`: es un
 * contrato («no se pudo leer», distinto de «no hay datos») del que depende que
 * la pantalla no acuse al plugin de un fallo de infraestructura, y estaba
 * sostenido solo por un try/catch que cualquier refactor puede borrar. Sin
 * estas pruebas, volver a `end = r.checkOutAt ?? span.end` o quitar el `try`
 * deja la suite entera en verde y la regresión llega a producción.
 */

const TZ = DEFAULT_TZ;
/** Instante UTC a partir de hora local de Costa Rica (UTC-6, sin horario de verano). */
const cr = (iso: string) => new Date(`${iso}-06:00`);

/** Lunes 21 de septiembre de 2026, día local completo. */
const lunes = { start: cr('2026-09-21T00:00:00'), end: cr('2026-09-21T23:59:59.999') };

type CheckInRow = { userId: string; checkInAt: Date; checkOutAt: Date | null };

/**
 * Doble mínimo de `ctx`: el servicio solo toca `ctx.prisma.checkInRecord`,
 * `ctx.query` y `ctx.logger.warn`. Mismo patrón que `presence.service.test.ts`
 * — no hace falta simular Redis, hooks ni el resto de PluginContext.
 */
function makeCtx(opts: {
  rows?: CheckInRow[];
  /** Filas que devuelve el SELECT de intervalos de estado. */
  intervals?: Array<{ status: string; started_at: string; ended_at: string | null }>;
  /** Valor de `MIN(started_at)` para `coverageStart`. */
  coverageMin?: string | null;
  /** Si se da, `ctx.query` rechaza con este error en vez de resolver. */
  rejectWith?: Error;
} = {}) {
  const warn = vi.fn();

  const query = vi.fn(async (sql: string) => {
    if (opts.rejectWith) throw opts.rejectWith;
    if (/MIN\(started_at\)/.test(sql)) return [{ min: opts.coverageMin ?? null }];
    return opts.intervals ?? [];
  });

  const findMany = vi.fn(async () => opts.rows ?? []);

  const ctx = {
    query,
    prisma: { checkInRecord: { findMany } },
    logger: { warn, log: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };

  return { ctx: ctx as unknown as PluginContext, warn, query, findMany };
}

function makeService(ctx: PluginContext, capHours = 12) {
  // `absences` no participa de ninguna de estas pruebas; se pasa un doble vacío
  // para no arrastrar AbsenceService entero.
  const absences = { listForUserDetailed: async () => [] } as unknown as AbsenceService;
  return new TimesheetService(ctx, () => TZ, absences, () => 8, () => capHours);
}

describe('TimesheetService.officeTime — la cota es solo para la sesión abierta', () => {
  it('una sesión CERRADA más larga que la cota no se acota', async () => {
    // 17 horas seguidas con salida marcada: raro, pero es un dato real que
    // alguien registró. La cota existe para la sesión que nadie cerró, no para
    // desconfiar de la que sí se cerró: recortarla acá inventaría un número que
    // contradice el registro, y encima con la nota al pie diciendo que se acotó.
    const { ctx } = makeCtx({
      rows: [{
        userId: 'u1',
        checkInAt: cr('2026-09-21T06:00:00'),
        checkOutAt: cr('2026-09-21T23:00:00'),
      }],
    });

    const out = await makeService(ctx, 12).officeTime(['u1'], lunes);
    const u1 = out.get('u1')!;

    expect(u1.totalMinutes).toBe(17 * 60);
    expect(u1.openSessionCapped).toBe(false);
  });

  it('una sesión ABIERTA sí se acota y queda marcada', async () => {
    // Entró a las 08:00 y nunca marcó salida. Sin cota, el total sería el resto
    // del período (casi 16 horas); con cota de 12, son 12 — y `openSessionCapped`
    // es lo único que le explica al jefe por qué el número no es el que esperaba.
    const { ctx } = makeCtx({
      rows: [{
        userId: 'u1',
        checkInAt: cr('2026-09-21T08:00:00'),
        checkOutAt: null,
      }],
    });

    const out = await makeService(ctx, 12).officeTime(['u1'], lunes);
    const u1 = out.get('u1')!;

    expect(u1.totalMinutes).toBe(12 * 60);
    expect(u1.openSessionCapped).toBe(true);
  });

  it('una sesión abierta VIEJA no marca la nota en un período que no toca', async () => {
    // Ana entró el viernes 18 a las 08:00 y nunca marcó salida; el jefe mira el
    // lunes 21. La fila sale igual en la consulta (no se puede acotar el
    // checkInAt por abajo: una sesión anterior al período puede seguir dentro),
    // pero la cota la cierra el viernes a las 20:00 y no aporta ni un minuto al
    // lunes. La nota «se acotó a 12 horas» al lado de «Sin tiempo registrado en
    // este período» hacía pensar que las horas de Ana se habían recortado, y no
    // hubo nada que recortar acá.
    const { ctx } = makeCtx({
      rows: [{
        userId: 'u1',
        checkInAt: cr('2026-09-18T08:00:00'),
        checkOutAt: null,
      }],
    });

    const out = await makeService(ctx, 12).officeTime(['u1'], lunes);
    const u1 = out.get('u1')!;

    expect(u1.totalMinutes).toBe(0);
    expect(u1.openSessionCapped).toBe(false);
  });

  it('propaga las horas de la cota configurada, no un 12 escrito a mano', async () => {
    // La pantalla dice «se acotó a N horas»: si el número viajara fijo, cambiar
    // MAX_OPEN_SESSION_HOURS mentiría en la nota al pie sin tocar el total.
    const { ctx } = makeCtx({
      rows: [{
        userId: 'u1',
        checkInAt: cr('2026-09-21T08:00:00'),
        checkOutAt: null,
      }],
    });

    const out = await makeService(ctx, 6).officeTime(['u1'], lunes);
    const u1 = out.get('u1')!;

    expect(u1.openSessionCapHours).toBe(6);
    expect(u1.totalMinutes).toBe(6 * 60);
  });

  it('quien no tiene ninguna sesión igual aparece en el resultado', async () => {
    // Una persona ausente del Map se leería en el llamador como «no existe» y
    // no como «no marcó horas»: son dos cosas distintas y solo una es cierta.
    const { ctx } = makeCtx({ rows: [] });

    const out = await makeService(ctx).officeTime(['u1', 'u2'], lunes);

    expect(out.get('u2')).toMatchObject({ userId: 'u2', totalMinutes: 0, openSessionCapped: false });
  });
});

describe('TimesheetService.statusBreakdown — degrada en null', () => {
  it('con la tabla legible devuelve los tramos agregados', async () => {
    const { ctx } = makeCtx({
      intervals: [
        { status: 'FOCUS', started_at: cr('2026-09-21T08:00:00').toISOString(), ended_at: cr('2026-09-21T10:00:00').toISOString() },
      ],
    });

    const out = await makeService(ctx).statusBreakdown('u1', lunes);

    expect(out).toEqual([{ status: 'FOCUS', minutes: 120 }]);
  });

  it('si la consulta rechaza devuelve null (no []) y deja un warning', async () => {
    // `null` no es `[]`. Con `[]` el reconcile manda todo el tiempo a «sin
    // registrar» y la pantalla dibuja un gráfico 100% gris: le atribuye al
    // plugin —o a la persona— lo que en realidad es la base caída o una
    // migración sin aplicar. Y el catch no es opcional: Express 4 no atrapa
    // rechazos de promesas, así que un 42P01 acá mata el proceso del API.
    const { ctx, warn } = makeCtx({ rejectWith: new Error('relation "office_status_intervals" does not exist') });

    await expect(makeService(ctx).statusBreakdown('u1', lunes)).resolves.toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('statusBreakdown');
  });
});

describe('TimesheetService.coverageStart — degrada en null', () => {
  it('devuelve la fecha local de la primera fila registrada', async () => {
    const { ctx } = makeCtx({ coverageMin: cr('2026-09-21T20:00:00').toISOString() });

    // 21 de septiembre a las 20:00 local son las 02:00 UTC del 22: leerlo con
    // `toISOString()` daría un día de más. La fecha tiene que salir en local.
    await expect(makeService(ctx).coverageStart()).resolves.toBe('2026-09-21');
  });

  it('si la consulta rechaza devuelve null y deja un warning', async () => {
    // El aviso de cobertura simplemente no se dibuja; lo que no puede pasar es
    // que un fallo de esta consulta —puramente informativa— tumbe el endpoint.
    const { ctx, warn } = makeCtx({ rejectWith: new Error('pool agotado') });

    await expect(makeService(ctx).coverageStart()).resolves.toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('coverageStart');
  });
});
