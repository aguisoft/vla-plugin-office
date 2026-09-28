import { describe, it, expect, vi } from 'vitest';
import { ComplianceService } from './compliance.service';
import type { PluginContext } from '@vla/plugin-sdk';
import type { TeamService } from './team.service';
import type { OrgService } from './org.service';
import type { HolidayService } from './holiday.service';
import type { TimesheetService } from './timesheet.service';
import { DEFAULT_TZ } from '../lib/local-date';

/**
 * `ComplianceService` combina siete fuentes independientes (usuarios activos,
 * excepciones del equipo, organigrama, catálogo de departamentos, feriados,
 * ausencias y el inicio del historial de estados) en un solo reporte para
 * RRHH. La afirmación central de la Task 9 es que NINGUNA de las siete puede
 * tumbar a las otras seis, y que la que falla queda en `null` -- nunca en
 * `0` ni en `[]`, que en una pantalla de cumplimiento se lee como "está
 * todo bien" cuando en realidad nadie pudo comprobarlo. Por eso cada
 * `describe` de abajo rompe una sola fuente a la vez y comprueba que el
 * resto del reporte sigue de pie.
 */

const TZ = DEFAULT_TZ;
const cr = (iso: string) => new Date(`${iso}-06:00`);
const ANCHOR = cr('2026-09-28T10:00:00'); // lunes de la semana de referencia

type RosterFake = Map<string, { managerUserId: string | null; departmentId: string | null; departmentName: string | null }>;

type ActiveUserRow = { id: string; firstName?: string; lastName?: string; email?: string };

function makeCtx(opts: {
  activeUsers?: ActiveUserRow[];
  rejectActiveUsers?: Error;
  ausenciasCount?: number;
  rejectAusencias?: Error;
  /**
   * Si se da, la SEGUNDA llamada a `ctx.prisma.user.findMany` rechaza -- esa
   * es `nombresPorUsuario(...)` (I1), que `cumplimiento()` dispara DESPUÉS de
   * `usuariosActivos()` (la primera llamada). Así se puede probar el fallo de
   * nombres sin tocar la lista de activos, que ya funciona con el mismo mock.
   */
  rejectNombres?: Error;
} = {}) {
  const warn = vi.fn();
  let userFindManyCalls = 0;
  const userFindMany = vi.fn(async () => {
    userFindManyCalls += 1;
    if (opts.rejectActiveUsers) throw opts.rejectActiveUsers;
    if (opts.rejectNombres && userFindManyCalls === 2) throw opts.rejectNombres;
    return opts.activeUsers ?? [];
  });
  const absenceCount = vi.fn(async () => {
    if (opts.rejectAusencias) throw opts.rejectAusencias;
    return opts.ausenciasCount ?? 0;
  });

  const ctx = {
    prisma: {
      user: { findMany: userFindMany },
      absenceRecord: { count: absenceCount },
    },
    logger: { warn, log: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };

  return { ctx: ctx as unknown as PluginContext, warn, userFindMany, absenceCount };
}

/** Doble mínimo de `TeamService`: `ComplianceService` solo llama a `excepciones`. */
function fakeTeam(opts: {
  sinMarcar30Dias?: Array<{ userId: string; nombre: string }>;
  sesionesAbiertas?: Array<{ userId: string; nombre: string; desde: string }>;
  reject?: Error;
} = {}): TeamService {
  return {
    excepciones: vi.fn(async () => {
      if (opts.reject) throw opts.reject;
      return { sinMarcar30Dias: opts.sinMarcar30Dias ?? [], sesionesAbiertas: opts.sesionesAbiertas ?? [] };
    }),
  } as unknown as TeamService;
}

/** Doble mínimo de `OrgService`: `ComplianceService` solo llama a `roster` y `departments`. */
function fakeOrg(opts: {
  roster?: RosterFake;
  rejectRoster?: Error;
  departments?: Array<{ id: string; name: string; headcount: number }>;
  rejectDepartments?: Error;
} = {}): OrgService {
  return {
    roster: vi.fn(async () => {
      if (opts.rejectRoster) throw opts.rejectRoster;
      return opts.roster ?? new Map();
    }),
    departments: vi.fn(async () => {
      if (opts.rejectDepartments) throw opts.rejectDepartments;
      return opts.departments ?? [];
    }),
  } as unknown as OrgService;
}

/** Doble mínimo de `HolidayService`: `ComplianceService` solo llama a `list`. */
function fakeHolidays(opts: { count?: number; reject?: Error } = {}): HolidayService {
  return {
    list: vi.fn(async () => {
      if (opts.reject) throw opts.reject;
      return Array.from({ length: opts.count ?? 0 }, () => ({})) as any;
    }),
  } as unknown as HolidayService;
}

/** Doble mínimo de `TimesheetService`: `ComplianceService` solo llama a `coverageStart`. */
function fakeTimesheet(coverageStart: string | null = null): TimesheetService {
  return { coverageStart: vi.fn(async () => coverageStart) } as unknown as TimesheetService;
}

function makeService(
  ctx: PluginContext,
  team: TeamService,
  org: OrgService,
  holidays: HolidayService,
  timesheet: TimesheetService,
) {
  return new ComplianceService(ctx, () => TZ, team, org, holidays, timesheet);
}

describe('ComplianceService.cumplimiento — camino feliz', () => {
  it('arma las siete fuentes con datos consistentes entre sí', async () => {
    const { ctx } = makeCtx({
      activeUsers: [
        { id: 'u1', firstName: 'Ana', lastName: 'Pérez' },
        { id: 'u2', firstName: 'Beto', lastName: 'Solís' },
        { id: 'u3', firstName: 'Cati', lastName: 'Ruiz' },
      ],
      ausenciasCount: 2,
    });
    const roster: RosterFake = new Map([
      ['u1', { managerUserId: 'jefe1', departmentId: 'd1', departmentName: 'Ventas' }],
      ['u2', { managerUserId: null, departmentId: 'd1', departmentName: 'Ventas' }],
      ['u3', { managerUserId: 'jefe1', departmentId: null, departmentName: null }],
    ]);

    const svc = makeService(
      ctx,
      fakeTeam({
        sinMarcar30Dias: [{ userId: 'u2', nombre: 'Beto Solís' }],
        sesionesAbiertas: [{ userId: 'u3', nombre: 'Cati Ruiz', desde: '2026-09-20' }],
      }),
      fakeOrg({ roster, departments: [{ id: 'd1', name: 'Ventas', headcount: 2 }, { id: 'd2', name: 'RRHH', headcount: 0 }] }),
      fakeHolidays({ count: 12 }),
      fakeTimesheet('2026-08-01'),
    );

    const out = await svc.cumplimiento('week', ANCHOR);

    expect(out.sinMarcar30Dias).toEqual([{ userId: 'u2', nombre: 'Beto Solís', departamento: 'Ventas' }]);
    expect(out.sesionesAbiertas).toEqual([{ userId: 'u3', nombre: 'Cati Ruiz', desde: '2026-09-20' }]);
    expect(out.sinJefe).toEqual([{ userId: 'u2', nombre: 'Beto Solís' }]);
    expect(out.sinDepartamento).toEqual([{ userId: 'u3', nombre: 'Cati Ruiz' }]);
    expect(out.feriadosCargados).toBe(12);
    expect(out.ausenciasDelPeriodo).toBe(2);
    expect(out.historialEstadosDesde).toBe('2026-08-01');
    expect(out.porDepartamento).toEqual([
      { departamento: 'Ventas', total: 2, sinMarcar: 1 },
      { departamento: 'RRHH', total: 0, sinMarcar: 0 },
    ]);
  });
});

describe('ComplianceService.cumplimiento — cada fuente degrada sola', () => {
  it('si la lista de usuarios activos falla, los cinco campos que dependen de ella quedan en null pero los tres independientes no', async () => {
    const { ctx, warn } = makeCtx({
      rejectActiveUsers: new Error('conexión perdida'),
      ausenciasCount: 3,
    });

    const svc = makeService(
      ctx,
      fakeTeam(),
      fakeOrg(),
      fakeHolidays({ count: 5 }),
      fakeTimesheet('2026-08-01'),
    );

    const out = await svc.cumplimiento('week', ANCHOR);

    expect(out.sinMarcar30Dias).toBeNull();
    expect(out.sesionesAbiertas).toBeNull();
    expect(out.sinJefe).toBeNull();
    expect(out.sinDepartamento).toBeNull();
    expect(out.porDepartamento).toBeNull();
    // Las tres fuentes que NO dependen de la lista de usuarios activos siguen de pie.
    expect(out.feriadosCargados).toBe(5);
    expect(out.ausenciasDelPeriodo).toBe(3);
    expect(out.historialEstadosDesde).toBe('2026-08-01');
    expect(warn).toHaveBeenCalled();
  });

  it('si TeamService.excepciones rechaza, solo sinMarcar30Dias/sesionesAbiertas/porDepartamento quedan en null', async () => {
    const { ctx } = makeCtx({ activeUsers: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez' }] });
    const roster: RosterFake = new Map([
      ['u1', { managerUserId: null, departmentId: 'd1', departmentName: 'Ventas' }],
    ]);

    const svc = makeService(
      ctx,
      fakeTeam({ reject: new Error('relation "check_in_records" does not exist') }),
      fakeOrg({ roster, departments: [{ id: 'd1', name: 'Ventas', headcount: 1 }] }),
      fakeHolidays({ count: 1 }),
      fakeTimesheet(null),
    );

    const out = await svc.cumplimiento('week', ANCHOR);

    expect(out.sinMarcar30Dias).toBeNull();
    expect(out.sesionesAbiertas).toBeNull();
    expect(out.porDepartamento).toBeNull();
    // El organigrama sí se pudo leer, así que sinJefe/sinDepartamento no degradan.
    expect(out.sinJefe).toEqual([{ userId: 'u1', nombre: 'Ana Pérez' }]);
    expect(out.sinDepartamento).toEqual([]);
    expect(out.feriadosCargados).toBe(1);
  });

  it('si el organigrama falla, sinJefe/sinDepartamento/porDepartamento quedan en null pero sinMarcar30Dias conserva su lista (sin departamento)', async () => {
    const { ctx } = makeCtx({ activeUsers: [{ id: 'u1' }, { id: 'u2' }] });

    const svc = makeService(
      ctx,
      fakeTeam({ sinMarcar30Dias: [{ userId: 'u2', nombre: 'Beto Solís' }] }),
      fakeOrg({ rejectRoster: new Error('conexión perdida'), departments: [{ id: 'd1', name: 'Ventas', headcount: 2 }] }),
      fakeHolidays(),
      fakeTimesheet(),
    );

    const out = await svc.cumplimiento('week', ANCHOR);

    expect(out.sinJefe).toBeNull();
    expect(out.sinDepartamento).toBeNull();
    expect(out.porDepartamento).toBeNull();
    // La lista en sí viene de `excepciones()`, que no falló -- solo la
    // columna de departamento de cada persona degrada a null.
    expect(out.sinMarcar30Dias).toEqual([{ userId: 'u2', nombre: 'Beto Solís', departamento: null }]);
  });

  it('si nombresPorUsuario falla (pero la lista de activos y el organigrama sí funcionan), sinJefe/sinDepartamento dicen "no disponible" y NO el userId crudo (I1)', async () => {
    const { ctx } = makeCtx({ activeUsers: [{ id: 'u1' }], rejectNombres: new Error('pool agotado') });
    const roster: RosterFake = new Map([
      ['u1', { managerUserId: null, departmentId: null, departmentName: null }],
    ]);

    const svc = makeService(
      ctx,
      fakeTeam(),
      fakeOrg({ roster, departments: [] }),
      fakeHolidays(),
      fakeTimesheet(),
    );

    const out = await svc.cumplimiento('week', ANCHOR);

    // Las LISTAS siguen de pie (vienen de `roster()`, que no falló) -- lo
    // único que degrada es el nombre de cada persona.
    expect(out.sinJefe).toEqual([{ userId: 'u1', nombre: 'no disponible' }]);
    expect(out.sinDepartamento).toEqual([{ userId: 'u1', nombre: 'no disponible' }]);
    expect(out.sinJefe?.some(p => p.nombre === 'u1')).toBe(false);
    expect(out.sinDepartamento?.some(p => p.nombre === 'u1')).toBe(false);
  });

  it('si el catálogo de departamentos falla, solo porDepartamento queda en null', async () => {
    const { ctx } = makeCtx({ activeUsers: [{ id: 'u1' }] });
    const roster: RosterFake = new Map([
      ['u1', { managerUserId: 'jefe1', departmentId: 'd1', departmentName: 'Ventas' }],
    ]);

    const svc = makeService(
      ctx,
      fakeTeam(),
      fakeOrg({ roster, rejectDepartments: new Error('conexión perdida') }),
      fakeHolidays(),
      fakeTimesheet(),
    );

    const out = await svc.cumplimiento('week', ANCHOR);

    expect(out.porDepartamento).toBeNull();
    expect(out.sinJefe).toEqual([]);
    expect(out.sinDepartamento).toEqual([]);
  });

  it('si HolidayService.list rechaza, feriadosCargados queda en null y el resto sigue', async () => {
    const { ctx } = makeCtx({ activeUsers: [{ id: 'u1' }], ausenciasCount: 1 });

    const svc = makeService(
      ctx,
      fakeTeam(),
      fakeOrg(),
      fakeHolidays({ reject: new Error('relation "holidays" does not exist') }),
      fakeTimesheet('2026-08-01'),
    );

    const out = await svc.cumplimiento('week', ANCHOR);

    expect(out.feriadosCargados).toBeNull();
    expect(out.ausenciasDelPeriodo).toBe(1);
    expect(out.historialEstadosDesde).toBe('2026-08-01');
  });

  it('si el conteo de ausencias rechaza, ausenciasDelPeriodo queda en null y el resto sigue', async () => {
    const { ctx } = makeCtx({
      activeUsers: [{ id: 'u1' }],
      rejectAusencias: new Error('conexión perdida'),
    });

    const svc = makeService(ctx, fakeTeam(), fakeOrg(), fakeHolidays({ count: 4 }), fakeTimesheet('2026-08-01'));

    const out = await svc.cumplimiento('week', ANCHOR);

    expect(out.ausenciasDelPeriodo).toBeNull();
    expect(out.feriadosCargados).toBe(4);
  });

  it('historialEstadosDesde es un simple paso-directo de TimesheetService.coverageStart (ya degrada a null por su cuenta)', async () => {
    const { ctx } = makeCtx({ activeUsers: [] });

    const svc = makeService(ctx, fakeTeam(), fakeOrg(), fakeHolidays(), fakeTimesheet(null));

    const out = await svc.cumplimiento('week', ANCHOR);

    expect(out.historialEstadosDesde).toBeNull();
  });
});

describe('ComplianceService.cumplimiento — cero real, no inventado', () => {
  it('con la organización limpia, los contadores dan cero de verdad, no null', async () => {
    const { ctx } = makeCtx({ activeUsers: [{ id: 'u1' }], ausenciasCount: 0 });
    const roster: RosterFake = new Map([
      ['u1', { managerUserId: 'jefe1', departmentId: 'd1', departmentName: 'Ventas' }],
    ]);

    const svc = makeService(
      ctx,
      fakeTeam({ sinMarcar30Dias: [], sesionesAbiertas: [] }),
      fakeOrg({ roster, departments: [{ id: 'd1', name: 'Ventas', headcount: 1 }] }),
      fakeHolidays({ count: 0 }),
      fakeTimesheet(null),
    );

    const out = await svc.cumplimiento('week', ANCHOR);

    expect(out.sinMarcar30Dias).toEqual([]);
    expect(out.sesionesAbiertas).toEqual([]);
    expect(out.sinJefe).toEqual([]);
    expect(out.sinDepartamento).toEqual([]);
    expect(out.feriadosCargados).toBe(0);
    expect(out.ausenciasDelPeriodo).toBe(0);
    expect(out.porDepartamento).toEqual([{ departamento: 'Ventas', total: 1, sinMarcar: 0 }]);
  });
});
