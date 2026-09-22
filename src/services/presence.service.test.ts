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
});
