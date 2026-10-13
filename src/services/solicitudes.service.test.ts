import { describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@vla/plugin-sdk';
import { SolicitudesService } from './solicitudes.service';

const TZ = 'America/Costa_Rica';
const AHORA = new Date('2026-10-12T15:00:00Z');

/** Base en memoria que entiende las consultas del servicio, y las registra. */
function armar(o: { jefeDe?: Record<string, string | null>; equipoDe?: Record<string, string[]>; ausencias?: any[] } = {}) {
  const sol: any[] = [];
  const eventos: any[] = [];
  const reKeys: Array<[string, string]> = [];
  const llamadas: Array<{ sql: string; params: unknown[] }> = [];
  const ausencias: any[] = [...(o.ausencias ?? [])];
  let n = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    llamadas.push({ sql, params });
    const p = params as any[];
    if (sql.startsWith('INSERT INTO office_solicitudes')) {
      const f = { id: uuid(), user_id: p[0], tipo: p[1], start_at: p[2], end_at: p[3], justificacion: p[4], estado: p[5],
        absence_id: p[6], resuelta_por: p[7], resuelta_en: p[8], motivo_resolucion: null, creada_por: p[9], creada_en: AHORA.toISOString() };
      sol.push(f); return [f];
    }
    if (sql.startsWith('INSERT INTO office_solicitud_eventos')) { eventos.push({ solicitud_id: p[0], accion: p[1], user_id: p[2] }); return []; }
    if (sql.startsWith('UPDATE office_absence_adjuntos')) { reKeys.push([p[1], p[0]]); return []; }
    if (sql.startsWith('UPDATE office_solicitudes')) {
      const f = sol.find(x => x.id === p[0]);
      Object.assign(f, { estado: p[1], absence_id: p[2], resuelta_por: p[3], resuelta_en: p[4], motivo_resolucion: p[5] });
      return [f];
    }
    if (sql.includes('WHERE id = $1::uuid')) return sol.filter(x => x.id === p[0]);
    if (sql.includes('WHERE absence_id = $1')) return sol.filter(x => x.absence_id === p[0]).map(x => ({ id: x.id }));
    if (sql.includes("estado = 'pendiente' AND absence_id IS NULL")) return sol.filter(x => x.user_id === p[0] && x.estado === 'pendiente' && !x.absence_id);
    if (sql.includes("estado = 'pendiente' AND user_id <> $1")) return sol.filter(x => x.estado === 'pendiente' && x.user_id !== p[0]);
    if (sql.includes("estado = 'pendiente' AND user_id IN")) return sol.filter(x => x.estado === 'pendiente' && p.includes(x.user_id));
    if (sql.includes('WHERE user_id = $1 ORDER BY')) return sol.filter(x => x.user_id === p[0]);
    if (sql.includes('creada_en <= $1::timestamptz')) return sol.filter(x => x.estado === 'pendiente' && x.creada_en <= p[0]);
    throw new Error(`consulta no esperada: ${sql.slice(0, 60)}`);
  });

  const ctx = {
    query,
    prisma: {
      absenceRecord: {
        create: vi.fn(async ({ data }: any) => { const r = { id: `abs-${ausencias.length + 1}`, ...data }; ausencias.push(r); return r; }),
        delete: vi.fn(async ({ where }: any) => { const i = ausencias.findIndex(a => a.id === where.id); if (i >= 0) ausencias.splice(i, 1); }),
      },
      user: { findMany: vi.fn(async () => []) },
    },
    hooks: { doAction: vi.fn(async () => undefined) },
    logger: { warn: vi.fn(), log: vi.fn(), error: vi.fn() },
  } as unknown as PluginContext;

  const absences = {
    listForUser: vi.fn(async (u: string) => ausencias.filter(a => a.userId === u).map(a => ({ type: a.type, startAt: new Date(a.startAt), endAt: new Date(a.endAt), justification: null }))),
    create: vi.fn(async (userId: string, input: any) => {
      const r = { id: `abs-${ausencias.length + 1}`, userId, type: input.type, startAt: input.startAt, endAt: input.endAt };
      ausencias.push(r); return { ok: true as const, id: r.id };
    }),
  };
  const org = {
    managerOf: vi.fn(async (u: string) => (o.jefeDe ?? { ana: 'jefa' })[u] ?? null),
    managedUserIds: vi.fn(async (v: string) => new Set((o.equipoDe ?? { jefa: ['ana'] })[v] ?? [])),
  };
  const avisos = { nueva: vi.fn(async () => undefined), resuelta: vi.fn(async () => undefined), cargada: vi.fn(async () => undefined) };
  const svc = new SolicitudesService(ctx, absences as any, org, avisos);
  return { svc, sol, eventos, reKeys, llamadas, ausencias, avisos, absences };
}

const permiso = { type: 'PERMISO', startAt: '2026-10-20T15:00:00.000Z', endAt: '2026-10-20T16:00:00.000Z', justification: 'trámite en el banco' };
const vacaciones = { type: 'VACACIONES', startAt: '2026-10-26', endAt: '2026-10-30', justification: 'viaje familiar' };

describe('SolicitudesService: crear', () => {
  it('un permiso vale ya (crea la ausencia) y queda pendiente para su jefa, que recibe el aviso', async () => {
    const { svc, ausencias, avisos } = armar();
    const r = await svc.crear('ana', permiso, 'ana', { esRrhh: false }, TZ);
    expect(r).toMatchObject({ ok: true, aprobadorId: 'jefa', solicitud: { estado: 'pendiente', absenceId: 'abs-1' } });
    expect(ausencias).toHaveLength(1);
    expect(avisos.nueva).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'PERMISO' }), 'jefa');
  });

  it('unas vacaciones NO valen hasta aprobarse: sin ausencia, los adjuntos cuelgan de la solicitud', async () => {
    const { svc, ausencias } = armar();
    const r = await svc.crear('ana', vacaciones, 'ana', { esRrhh: false }, TZ);
    expect(r.ok && r.solicitud.absenceId).toBeNull();
    expect(r.ok && r.idAdjuntos).toBe(r.ok && r.solicitud.id);
    expect(ausencias).toHaveLength(0);
  });

  it('no deja pedir otras vacaciones encima de unas pendientes', async () => {
    const { svc } = armar();
    await svc.crear('ana', vacaciones, 'ana', { esRrhh: false }, TZ);
    const r = await svc.crear('ana', { ...vacaciones, startAt: '2026-10-28', endAt: '2026-11-02' }, 'ana', { esRrhh: false }, TZ);
    expect(r).toMatchObject({ ok: false, conflict: expect.anything() });
  });

  it('cargada por RRHH para otra persona: ya aprobada, sin pedirle a nadie, y la persona se entera', async () => {
    const { svc, avisos, ausencias } = armar();
    const r = await svc.crear('ana', vacaciones, 'rrhh', { esRrhh: true }, TZ);
    expect(r.ok && r.solicitud.estado).toBe('aprobada');
    expect(ausencias).toHaveLength(1);
    expect(avisos.nueva).not.toHaveBeenCalled();
    expect(avisos.cargada).toHaveBeenCalledWith(expect.objectContaining({ userId: 'ana', estado: 'aprobada' }), 'rrhh');
  });

  it('RRHH sin jefe que pide para sí: aprobada sola y sin el aviso de «cargada»', async () => {
    const { svc, avisos } = armar({ jefeDe: {} });
    const r = await svc.crear('rrhh', vacaciones, 'rrhh', { esRrhh: true }, TZ);
    expect(r.ok && r.solicitud.estado).toBe('aprobada');
    expect(avisos.cargada).not.toHaveBeenCalled();
  });
});

describe('SolicitudesService: responder', () => {
  it('la jefa aprueba unas vacaciones: se crea la ausencia y los adjuntos pasan a ella', async () => {
    const { svc, ausencias, reKeys, avisos } = armar();
    const c = await svc.crear('ana', vacaciones, 'ana', { esRrhh: false }, TZ);
    const id = c.ok ? c.solicitud.id : '';
    const r = await svc.resolver(id, 'jefa', 'aprobar', '', false, AHORA);
    expect(r).toMatchObject({ ok: true, solicitud: { estado: 'aprobada', absenceId: 'abs-1', resueltaPor: 'jefa' } });
    expect(ausencias).toHaveLength(1);
    expect(reKeys).toEqual([[id, 'abs-1']]);
    expect(avisos.resuelta).toHaveBeenCalled();
  });

  it('la jefa rechaza un permiso futuro: se quita la ausencia, la solicitud queda con el motivo', async () => {
    const { svc, ausencias, eventos } = armar();
    const c = await svc.crear('ana', permiso, 'ana', { esRrhh: false }, TZ);
    const r = await svc.resolver(c.ok ? c.solicitud.id : '', 'jefa', 'rechazar', 'ese día no hay cobertura', false, AHORA);
    expect(r).toMatchObject({ ok: true, solicitud: { estado: 'rechazada', absenceId: null, motivoResolucion: 'ese día no hay cobertura' } });
    expect(ausencias).toHaveLength(0);
    expect(eventos.map(e => e.accion)).toEqual(['creada', 'rechazada']);
  });

  it('alguien que no es su jefe ni RRHH no puede; nadie aprueba la suya', async () => {
    const { svc } = armar();
    const c = await svc.crear('ana', permiso, 'ana', { esRrhh: false }, TZ);
    const id = c.ok ? c.solicitud.id : '';
    expect(await svc.resolver(id, 'otro', 'aprobar', '', false, AHORA)).toMatchObject({ ok: false, status: 403 });
    expect(await svc.resolver(id, 'ana', 'aprobar', '', true, AHORA)).toMatchObject({ ok: false, status: 403 });
    expect(await svc.resolver(id, 'rrhh', 'aprobar', '', true, AHORA)).toMatchObject({ ok: true });
  });

  it('rechazar sin motivo: 400', async () => {
    const { svc } = armar();
    const c = await svc.crear('ana', permiso, 'ana', { esRrhh: false }, TZ);
    expect(await svc.resolver(c.ok ? c.solicitud.id : '', 'jefa', 'rechazar', '', false, AHORA)).toMatchObject({ ok: false, status: 400 });
  });

  it('la persona cancela la suya antes de que empiece; quita la ausencia, sin avisarse a sí misma', async () => {
    const { svc, ausencias, avisos } = armar();
    const c = await svc.crear('ana', permiso, 'ana', { esRrhh: false }, TZ);
    const r = await svc.cancelar(c.ok ? c.solicitud.id : '', 'ana', '', false, AHORA);
    expect(r).toMatchObject({ ok: true, solicitud: { estado: 'cancelada' } });
    expect(ausencias).toHaveLength(0);
    expect(avisos.resuelta).not.toHaveBeenCalled();
  });
});

describe('SolicitudesService: bandeja', () => {
  it('la jefa ve las pendientes de su equipo; RRHH, todas menos las suyas', async () => {
    const { svc } = armar({ jefeDe: { ana: 'jefa', beto: 'otro' }, equipoDe: { jefa: ['ana'] } });
    await svc.crear('ana', permiso, 'ana', { esRrhh: false }, TZ);
    await svc.crear('beto', permiso, 'beto', { esRrhh: false }, TZ);
    expect((await svc.bandeja('jefa', false)).map(s => s.userId)).toEqual(['ana']);
    expect((await svc.bandeja('rrhh', true)).map(s => s.userId).sort()).toEqual(['ana', 'beto']);
  });
});

describe('SolicitudesService: SQL', () => {
  it('sin ANY(), sin Date como parámetro y con tantos marcadores como parámetros', async () => {
    const { svc, llamadas } = armar({ equipoDe: { jefa: ['ana', 'beto'] } });
    const c = await svc.crear('ana', permiso, 'ana', { esRrhh: false }, TZ);
    await svc.bandeja('jefa', false);
    await svc.resolver(c.ok ? c.solicitud.id : '', 'jefa', 'aprobar', '', false, AHORA);
    await svc.pendientesViejas(24, AHORA);
    for (const { sql, params } of llamadas) {
      expect(sql).not.toMatch(/ANY\s*\(/);
      expect(params.some(p => p instanceof Date)).toBe(false);
      expect(new Set(sql.match(/\$\d+/g) ?? []).size).toBe(params.length);
    }
  });
});
