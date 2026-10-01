import { describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@vla/plugin-sdk';
import { BitrixUserService } from './bitrix-user.service';

interface Llamada { sql: string; params: unknown[] }

const AHORA = Date.parse('2026-10-01T18:00:00Z');

/**
 * Doble con una tabla en memoria. Además de responder, registra cada consulta
 * para inspeccionarla: marcadores contra parámetros, ningún ANY(), ningún Date.
 */
function armar(opts: { mapeo?: number | null; refresh?: () => Promise<any> } = {}) {
  const tabla = new Map<string, any>();
  const llamadas: Llamada[] = [];
  const redis = new Map<string, string>();
  const refreshUserToken = vi.fn(opts.refresh ?? (async () => ({
    accessToken: 'NUEVO', refreshToken: 'REFRESH-NUEVO', expiresAt: AHORA + 3_600_000,
  })));

  const ctx = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      llamadas.push({ sql, params });
      if (sql.startsWith('INSERT')) {
        const [user_id, bitrix_user_id, access_token, refresh_token, expires_at] = params as string[];
        tabla.set(user_id, { user_id, bitrix_user_id, access_token, refresh_token, expires_at: new Date(expires_at), conectado_at: new Date(AHORA) });
        return [];
      }
      if (sql.startsWith('DELETE')) { tabla.delete(params[0] as string); return []; }
      if (sql.includes('WHERE user_id = $1')) return tabla.has(params[0] as string) ? [tabla.get(params[0] as string)] : [];
      return [...tabla.values()].map(f => ({ user_id: f.user_id }));
    }),
    prisma: {
      bitrixUserMapping: {
        findFirst: vi.fn(async () => (opts.mapeo === null ? null : { bitrixUserId: opts.mapeo ?? 949 })),
      },
    },
    redis: {
      get: vi.fn(async (k: string) => redis.get(k) ?? null),
      set: vi.fn(async (k: string, v: string) => { redis.set(k, v); }),
      del: vi.fn(async (k: string) => { redis.delete(k); }),
    },
    bitrix: { refreshUserToken },
    logger: { warn: vi.fn(), error: vi.fn(), log: vi.fn(), info: vi.fn() },
  } as unknown as PluginContext;

  return { svc: new BitrixUserService(ctx), tabla, llamadas, refreshUserToken };
}

const tokens = (expiresAt: number) => ({ accessToken: 'ACTUAL', refreshToken: 'REFRESH', expiresAt });
const marcadores = (sql: string) => new Set(sql.match(/\$\d+/g) ?? []).size;

describe('BitrixUserService: SQL', () => {
  it('ninguna consulta usa ANY(), pasa un Date ni descuadra marcadores', async () => {
    const { svc, llamadas } = armar();
    await svc.guardar('ana', tokens(AHORA + 3_600_000), '949');
    await svc.obtenerVigente('ana', AHORA);
    await svc.estado('ana');
    await svc.conectados();
    await svc.desconectar('ana');

    expect(llamadas.length).toBeGreaterThanOrEqual(5);
    for (const { sql, params } of llamadas) {
      expect(sql).not.toMatch(/ANY\s*\(/);
      expect(params.some(p => p instanceof Date)).toBe(false);
      expect(marcadores(sql)).toBe(params.length);
    }
  });

  it('expires_at viaja como ISO', async () => {
    const { svc, llamadas } = armar();
    await svc.guardar('ana', tokens(AHORA), '949');
    expect(llamadas[0].params[4]).toBe('2026-10-01T18:00:00.000Z');
  });
});

describe('BitrixUserService: vigencia', () => {
  it('sin conexión devuelve null', async () => {
    const { svc } = armar();
    expect(await svc.obtenerVigente('ana', AHORA)).toBeNull();
  });

  it('un token vigente se usa sin refrescar', async () => {
    const { svc, refreshUserToken } = armar();
    await svc.guardar('ana', tokens(AHORA + 3_600_000), '949');
    expect(await svc.obtenerVigente('ana', AHORA)).toBe('ACTUAL');
    expect(refreshUserToken).not.toHaveBeenCalled();
  });

  it('uno por vencer se refresca y se guarda el par nuevo', async () => {
    const { svc, tabla, refreshUserToken } = armar();
    await svc.guardar('ana', tokens(AHORA + 10_000), '949');

    expect(await svc.obtenerVigente('ana', AHORA)).toBe('NUEVO');
    expect(refreshUserToken).toHaveBeenCalledWith('REFRESH');
    expect(tabla.get('ana').refresh_token).toBe('REFRESH-NUEVO');
    expect(tabla.get('ana').bitrix_user_id).toBe('949');
  });

  /** Bitrix invalida el refresh al usarlo: dos en paralelo, el segundo da invalid_grant. */
  it('dos pedidos simultáneos refrescan una sola vez', async () => {
    const { svc, refreshUserToken } = armar();
    await svc.guardar('ana', tokens(AHORA), '949');

    const [a, b] = await Promise.all([svc.obtenerVigente('ana', AHORA), svc.obtenerVigente('ana', AHORA)]);

    expect(a).toBe('NUEVO');
    expect(b).toBe('NUEVO');
    expect(refreshUserToken).toHaveBeenCalledTimes(1);
  });

  it('invalid_grant borra la conexión: la persona revocó y tiene que reconectar', async () => {
    const { svc, tabla } = armar({ refresh: async () => { throw new Error('OAuth error: invalid_grant — x'); } });
    await svc.guardar('ana', tokens(AHORA), '949');

    expect(await svc.obtenerVigente('ana', AHORA)).toBeNull();
    expect(tabla.has('ana')).toBe(false);
  });

  it('un corte de red NO borra la conexión', async () => {
    const { svc, tabla } = armar({ refresh: async () => { throw new Error('fetch failed'); } });
    await svc.guardar('ana', tokens(AHORA), '949');

    await expect(svc.obtenerVigente('ana', AHORA)).rejects.toThrow('fetch failed');
    expect(tabla.has('ana')).toBe(true);
  });
});

describe('BitrixUserService.alAutorizar', () => {
  const payload = (bitrixUserId: string | null) => ({
    userId: 'ana', bitrixUserId, tokens: tokens(AHORA + 3_600_000),
  });

  it('guarda los tokens del userId del evento cuando el Bitrix coincide', async () => {
    const { svc, tabla } = armar({ mapeo: 949 });
    expect(await svc.alAutorizar(payload('949'))).toBe('ok');
    expect([...tabla.keys()]).toEqual(['ana']);
    expect((await svc.estado('ana')).conectado).toBe(true);
  });

  it('si autorizó otra cuenta de Bitrix, no guarda nada y lo deja dicho', async () => {
    const { svc, tabla } = armar({ mapeo: 949 });
    expect(await svc.alAutorizar(payload('1001'))).toBe('otra_cuenta');
    expect(tabla.size).toBe(0);
    expect(await svc.estado('ana')).toEqual({ conectado: false, rechazo: 'otra_cuenta' });
  });

  it('sin mapeo VLA ↔ Bitrix tampoco guarda', async () => {
    const { svc, tabla } = armar({ mapeo: null });
    expect(await svc.alAutorizar(payload('949'))).toBe('sin_mapeo');
    expect(tabla.size).toBe(0);
  });

  it('una conexión buena borra el rechazo anterior', async () => {
    const { svc } = armar({ mapeo: 949 });
    await svc.alAutorizar(payload('1001'));
    await svc.alAutorizar(payload('949'));
    expect((await svc.estado('ana')).rechazo).toBeUndefined();
  });
});
