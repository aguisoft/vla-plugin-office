import { describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@vla/plugin-sdk';
import { HolidayService, listaIn } from './holiday.service';

/**
 * Estas pruebas existen por un incidente concreto: el 2026-09-30 el plugin
 * salió a producción con `user_id = ANY($1)` y con un `Date` de JS como
 * parámetro de una columna `date`. Las dos cosas compilaban, pasaban las 435
 * pruebas y reventaban en la primera llamada real:
 *
 *   malformed array literal: "abc,def,ghi" — Array value must start with "{"
 *   invalid input syntax for type date: "Mon Dec 28 2026 00:00:00 GMT+0000"
 *
 * La causa de que ninguna prueba lo viera es que el doble de `ctx.query` no
 * habla SQL: acepta cualquier cosa. Así que acá el doble no ejecuta la
 * consulta — la INSPECCIONA, y verifica lo único que el driver exige y que
 * TypeScript no puede comprobar: que los marcadores cuadren con los
 * parámetros, y que nada viaje como objeto Date.
 *
 * El peor de los dos fallos era silencioso: `TeamService` atrapa el error de
 * feriados y sigue sin descontar ninguno, así que el denominador de todo el
 * equipo quedaba mal sin que nada se rompiera a la vista.
 */

interface Llamada { sql: string; params: unknown[] }

function fakeCtx(llamadas: Llamada[], filas: unknown[] = []): PluginContext {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      llamadas.push({ sql, params });
      return filas;
    }),
    prisma: {
      holiday: {
        findUnique: vi.fn(async () => ({
          id: 'h1', date: new Date('2026-12-25T00:00:00Z'), country: 'CR', name: 'Navidad',
        })),
        findMany: vi.fn(async () => []),
      },
    },
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  } as unknown as PluginContext;
}

/** Cuántos `$n` distintos referencia el SQL. */
function marcadores(sql: string): number {
  const encontrados = new Set(sql.match(/\$\d+/g) ?? []);
  return encontrados.size;
}

describe('listaIn', () => {
  it('genera un marcador por valor, empezando en $1', () => {
    expect(listaIn(3)).toBe('$1, $2, $3');
  });

  it('puede arrancar desde otro número, para mezclarse con parámetros previos', () => {
    expect(listaIn(2, 4)).toBe('$4, $5');
  });

  it('con cero valores devuelve vacío — quien la use tiene que cortar antes', () => {
    expect(listaIn(0)).toBe('');
  });
});

describe('el SQL que sale hacia el driver', () => {
  it('pendientesDe: tantos marcadores como subordinados, y ningún ANY()', async () => {
    const llamadas: Llamada[] = [];
    const svc = new HolidayService(fakeCtx(llamadas));
    await svc.pendientesDe(['u1', 'u2', 'u3']);

    expect(llamadas).toHaveLength(1);
    const { sql, params } = llamadas[0];
    expect(sql).not.toMatch(/ANY\s*\(/);
    expect(params).toEqual(['u1', 'u2', 'u3']);
    expect(marcadores(sql)).toBe(params.length);
  });

  it('pendientesDe: sin subordinados no consulta nada (un IN vacío es SQL inválido)', async () => {
    const llamadas: Llamada[] = [];
    const svc = new HolidayService(fakeCtx(llamadas));
    expect(await svc.pendientesDe([])).toEqual([]);
    expect(llamadas).toHaveLength(0);
  });

  it('effectiveDatesByUser: un marcador por usuario, ningún ANY()', async () => {
    const llamadas: Llamada[] = [];
    const svc = new HolidayService(fakeCtx(llamadas));
    await svc.effectiveDatesByUser(
      new Map([['u1', 'CR'], ['u2', 'NI']]),
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-09-30T00:00:00Z'),
    );

    const q = llamadas.find(l => l.sql.includes('office_holiday_overrides'));
    expect(q).toBeDefined();
    expect(q!.sql).not.toMatch(/ANY\s*\(/);
    expect(q!.params).toEqual(['u1', 'u2']);
    expect(marcadores(q!.sql)).toBe(q!.params.length);
  });

  it('setOverride: la fecha viaja como YYYY-MM-DD, nunca como Date', async () => {
    const llamadas: Llamada[] = [];
    const svc = new HolidayService(fakeCtx(llamadas));
    const r = await svc.setOverride(
      'u1', 'h1', new Date('2026-12-28T00:00:00Z'),
      'Cierre de mes, lo tomo el 28', 'CR', 'America/Costa_Rica', true,
    );
    expect(r.ok).toBe(true);

    const { sql, params } = llamadas[0];
    // Ningún parámetro puede ser un Date: el driver lo pasa por toString() y
    // Postgres rechaza "Mon Dec 28 2026 ...".
    expect(params.some(p => p instanceof Date)).toBe(false);
    expect(params).toContain('2026-12-28');
    expect(marcadores(sql)).toBe(params.length);
  });

  it('setOverride sin jefe: queda APPROVED y decided_at viaja como texto ISO', async () => {
    const llamadas: Llamada[] = [];
    const svc = new HolidayService(fakeCtx(llamadas));
    const r = await svc.setOverride(
      'u1', 'h1', new Date('2026-12-28T00:00:00Z'),
      'Cierre de mes, lo tomo el 28', 'CR', 'America/Costa_Rica', false,
    );
    expect(r).toMatchObject({ ok: true, status: 'APPROVED' });
    expect(llamadas[0].params.some(p => p instanceof Date)).toBe(false);
    expect(llamadas[0].params).toContain('APPROVED');
  });

  it('setOverride con jefe: queda PENDING y sin fecha de decisión', async () => {
    const llamadas: Llamada[] = [];
    const svc = new HolidayService(fakeCtx(llamadas));
    const r = await svc.setOverride(
      'u1', 'h1', new Date('2026-12-28T00:00:00Z'),
      'Cierre de mes, lo tomo el 28', 'CR', 'America/Costa_Rica', true,
    );
    expect(r).toMatchObject({ ok: true, status: 'PENDING' });
    expect(llamadas[0].params).toContain('PENDING');
    expect(llamadas[0].params).toContain(null);
  });
});
