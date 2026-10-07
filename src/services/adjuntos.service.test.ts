import { describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@vla/plugin-sdk';
import { AdjuntosService } from './adjuntos.service';

describe('AdjuntosService.listar', () => {
  it('con varias ausencias no usa ANY(): un marcador por id (ctx.query no tipa arreglos)', async () => {
    const query = vi.fn(async () => []);
    const svc = new AdjuntosService({ query } as unknown as PluginContext, '/tmp/x');
    await svc.listar(['633e469e', 'c235c553', 'aaaa']);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).not.toMatch(/ANY\s*\(/);
    expect(sql).toContain('IN ($1, $2, $3)');
    expect(params).toEqual(['633e469e', 'c235c553', 'aaaa']);
    expect(params.some(p => Array.isArray(p))).toBe(false);
  });
  it('sin ausencias no consulta', async () => {
    const query = vi.fn(async () => []);
    expect(await new AdjuntosService({ query } as unknown as PluginContext, '/tmp/x').listar([])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
