import { describe, it, expect, vi } from 'vitest';
import { PresenceService } from './presence.service';
import type { PluginContext } from '@vla/plugin-sdk';

/**
 * `recordTransition` arma dos formas de SQL distintas según si el intervalo
 * abierto ya tiene el mismo estado o no. Estas pruebas afirman la FORMA
 * exacta del texto que se manda a `ctx.query`, no solo que la llamada
 * "funcionó" — normalmente afirmar la implementación así es mal olor, pero
 * acá se hace a propósito: la diferencia entre el SQL que funciona y el que
 * revienta con 23505 en Postgres real (ver Task 7 — el INSERT con `VALUES`
 * suelto no ve el `UPDATE` hermano del mismo `WITH`, porque Postgres no
 * garantiza visibilidad entre CTEs de escritura sin relación
 * productor/consumidor) es exactamente esa forma. Y como `recordTransition`
 * nunca lanza — el `catch` se traga cualquier error y solo deja un warning —
 * si un refactor futuro vuelve a la forma rota, ningún llamador se entera:
 * la regresión es silenciosa, cada transición falla en la sombra, y solo se
 * ve como "sin registrar" creciendo en el reporte del dashboard. Sin esta
 * prueba, nada en el repo detecta ese regreso.
 */

type Call = { sql: string; params: unknown[] };

/**
 * Doble mínimo de `ctx`: `recordTransition` solo toca `ctx.query` y
 * `ctx.logger.warn`, así que no hace falta simular Prisma, Redis ni el resto
 * de PluginContext.
 */
function makeCtx(opts: {
  /** Estado del intervalo abierto que "ve" el SELECT inicial, o null si no hay ninguno. */
  openStatus?: string | null;
  /** Si se da, ctx.query rechaza con este error en vez de resolver. */
  rejectWith?: Error;
}) {
  const calls: Call[] = [];
  const warn = vi.fn();

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (opts.rejectWith) throw opts.rejectWith;

    if (sql.includes('SELECT status FROM office_status_intervals')) {
      return opts.openStatus != null ? [{ status: opts.openStatus }] : [];
    }
    return [];
  });

  const ctx = {
    query,
    logger: { warn, log: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };

  return { ctx: ctx as unknown as PluginContext, calls, warn };
}

describe('PresenceService.recordTransition — forma del SQL', () => {
  it('al abrir un estado nuevo, el INSERT depende de `cerrado` (no un VALUES suelto)', async () => {
    const { ctx, calls } = makeCtx({ openStatus: 'AVAILABLE' });
    const service = new PresenceService(ctx);

    // Método privado: se accede vía cast a propósito, es la única forma de
    // probar la forma del SQL sin ejercitar checkIn/checkOut/updateStatus
    // completos (que arrastran Prisma, Redis y hooks que no vienen al caso).
    await (service as any).recordTransition('u1', 'FOCUS', new Date(), 'motivo', 'WEB');

    const insert = calls.find(c => /INSERT INTO office_status_intervals/.test(c.sql));
    expect(insert).toBeDefined();
    // La forma exacta que evita el 23505 (ver Task 7): el INSERT tiene que
    // leer la salida de `cerrado`, nunca un VALUES literal desconectado.
    expect(insert!.sql).toContain('FROM (SELECT count(*) FROM cerrado)');
    expect(insert!.sql).not.toContain('VALUES (');
  });

  it('al repetir el mismo estado, actualiza la justificación y no toca el CTE', async () => {
    const { ctx, calls } = makeCtx({ openStatus: 'FOCUS' });
    const service = new PresenceService(ctx);

    await (service as any).recordTransition('u1', 'FOCUS', new Date(), 'nuevo motivo', 'WEB');

    // Solo dos llamadas: el SELECT que consulta el abierto y el UPDATE de
    // justificación. Si el CTE se disparara acá, el intervalo se partiría.
    expect(calls).toHaveLength(2);
    const update = calls[1];
    expect(update.sql).toMatch(/UPDATE office_status_intervals SET justification/);
    expect(update.sql).not.toContain('WITH cerrado');
    expect(calls.some(c => /INSERT INTO office_status_intervals/.test(c.sql))).toBe(false);
  });

  it('si ctx.query rechaza, recordTransition resuelve igual y deja un warning', async () => {
    const { ctx, warn } = makeCtx({
      openStatus: 'AVAILABLE',
      rejectWith: new Error('tabla no existe'),
    });
    const service = new PresenceService(ctx);

    // NUNCA lanza: un fallo del historial no puede impedir que alguien
    // cambie de estado (ver Step 6 de Task 7, verificado también en vivo).
    await expect(
      (service as any).recordTransition('u1', 'FOCUS', new Date(), null, 'WEB'),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('No se pudo registrar la transición');
  });

  // El caso real del 2-oct-2026: dos cambios a la vez, el segundo chocaba con 23505 y se perdía.
  it('si choca con otro cambio simultáneo (23505), reintenta y registra el estado nuevo', async () => {
    const { ctx, calls, warn } = makeCtx({ openStatus: 'AVAILABLE' });
    const query = (ctx as any).query as ReturnType<typeof vi.fn>;
    const original = query.getMockImplementation()!;
    let choques = 0;
    query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (/INSERT INTO office_status_intervals/.test(sql) && choques++ === 0) {
        throw new Error('Raw query failed. Code: `23505`. Message: `Key (user_id)=(u1) already exists.`');
      }
      return original(sql, params);
    });
    await (new PresenceService(ctx) as any).recordTransition('u1', 'IN_MEETING_INTERNAL', new Date(), null, 'WEB');
    expect(query.mock.calls.filter(c => /INSERT INTO office_status_intervals/.test(String(c[0])))).toHaveLength(2);
    expect(calls.filter(c => /INSERT INTO office_status_intervals/.test(c.sql))).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('otros errores no se reintentan', async () => {
    const { ctx, calls, warn } = makeCtx({ openStatus: 'AVAILABLE', rejectWith: new Error('tabla no existe') });
    await (new PresenceService(ctx) as any).recordTransition('u1', 'FOCUS', new Date(), null, 'WEB');
    expect(calls).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('PresenceService.escritorioConectado', () => {
  it('distingue la app de escritorio de la web, y deja de contarla al desconectarse', () => {
    const { ctx } = makeCtx({});
    // Al cerrarse la última pantalla se anota en Redis desde cuándo no está.
    const service = new PresenceService({ ...ctx, redis: { set: vi.fn(async () => 'OK') } } as unknown as PluginContext);
    const salirWeb = service.subscribe(() => undefined, 'ana');
    expect(service.escritorioConectado('ana')).toBe(false);

    const salirApp = service.subscribe(() => undefined, 'ana', true);
    expect(service.escritorioConectado('ana')).toBe(true);
    expect(service.escritorioConectado('beto')).toBe(false);

    salirApp();
    expect(service.escritorioConectado('ana')).toBe(false);
    expect(service.conectados()).toEqual(['ana']);
    salirWeb();
    expect(service.conectados()).toEqual([]);
  });
});

describe('PresenceService.updateStatusIf', () => {
  function armar(count: number) {
    const { ctx } = makeCtx({});
    const updateMany = vi.fn(async () => ({ count }));
    const doAction = vi.fn(async () => undefined);
    const fila = { userId: 'ana', isCheckedIn: true, status: 'IN_MEETING_EXTERNAL', justification: 'Demo' };
    const service = new PresenceService({
      ...ctx,
      prisma: { presenceStatus: { updateMany, findUnique: vi.fn(async () => fila) } },
      redis: { setJson: vi.fn(async () => undefined) },
      hooks: { doAction },
    } as unknown as PluginContext);
    return { service, updateMany, doAction };
  }

  it('escribe solo si sigue en la oficina con el estado que se leyó y sin reunión de la oficina', async () => {
    const { service, updateMany } = armar(1);
    const r = await service.updateStatusIf('ana', { status: 'AVAILABLE', justification: null }, 'IN_MEETING_EXTERNAL', { justification: 'Demo', source: 'AUTO' });
    expect(r).toMatchObject({ status: 'IN_MEETING_EXTERNAL' });
    const arg = (updateMany.mock.calls[0] as any[])[0];
    expect(arg.where).toEqual({ userId: 'ana', isCheckedIn: true, status: 'AVAILABLE', justification: null, meetingId: null });
    // Un cambio automático no es actividad de la persona.
    expect(arg.data).not.toHaveProperty('lastActivityAt');
  });

  it('si la persona lo cambió en el medio, no toca nada ni avisa', async () => {
    const { service, doAction } = armar(0);
    expect(await service.updateStatusIf('ana', { status: 'AVAILABLE', justification: null }, 'IN_MEETING_EXTERNAL', { source: 'AUTO' })).toBeNull();
    expect(doAction).not.toHaveBeenCalled();
  });
});
