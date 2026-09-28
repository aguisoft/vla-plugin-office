import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TeamService } from './team.service';
import type { PluginContext } from '@vla/plugin-sdk';
import { aggregateSessions, capOpenSession, periodBounds } from '../lib/timesheet';
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
  /**
   * Filas de origen para el `groupBy` de "último registro por usuario"
   * (C1). Por omisión se derivan de `checkIns`, así que la mayoría de las
   * pruebas no necesita tocar esto -- solo la prueba de C1 que exige una
   * sesión FUERA de la ventana que sí trae `checkIns` la pisa con `ultimos`.
   */
  ultimos?: CheckInRow[];
  /** Si se da, el `groupBy` de "último registro por usuario" rechaza. */
  rejectUltimo?: Error;
} = {}) {
  const warn = vi.fn();

  /**
   * Simula el WHERE real de `checkInsDelEquipo`
   * (`checkInAt: { lte: queryEnd }, OR: [{ checkOutAt: null }, { checkOutAt: { gte: queryStart } }]`)
   * a partir de los argumentos de la llamada. Sin este filtro el doble
   * devolvía TODO sin importar la ventana pedida, y eso escondía justo el
   * bug de C1: una sesión vieja se habría colado en `rows` igual que en
   * producción NO se cuela, y la prueba de la ventana de la norma no podría
   * reproducir nada.
   */
  const checkInFindMany = vi.fn(async (args: any) => {
    if (opts.rejectCheckIns) throw opts.rejectCheckIns;
    const rows = opts.checkIns ?? [];
    const queryEnd: Date | undefined = args?.where?.checkInAt?.lte;
    const orClause: any[] = args?.where?.OR ?? [];
    const queryStart: Date | undefined = orClause.find(c => c?.checkOutAt?.gte)?.checkOutAt?.gte;
    if (queryEnd === undefined && queryStart === undefined) return rows; // otra forma de WHERE (p.ej. excepciones()): sin filtrar
    return rows.filter(r => {
      if (queryEnd !== undefined && r.checkInAt > queryEnd) return false;
      const abierta = r.checkOutAt == null;
      if (!abierta && queryStart !== undefined && r.checkOutAt! < queryStart) return false;
      return true;
    });
  });
  const userFindMany = vi.fn(async () => {
    if (opts.rejectUsers) throw opts.rejectUsers;
    return opts.users ?? [];
  });
  const checkInGroupBy = vi.fn(async () => {
    if (opts.rejectUltimo) throw opts.rejectUltimo;
    const fuente = opts.ultimos ?? opts.checkIns ?? [];
    const max = new Map<string, Date>();
    for (const r of fuente) {
      const actual = max.get(r.userId);
      if (!actual || r.checkInAt > actual) max.set(r.userId, r.checkInAt);
    }
    return [...max.entries()].map(([userId, checkInAt]) => ({ userId, _max: { checkInAt } }));
  });

  const ctx = {
    prisma: {
      checkInRecord: { findMany: checkInFindMany, groupBy: checkInGroupBy },
      user: { findMany: userFindMany },
    },
    logger: { warn, log: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };

  return { ctx: ctx as unknown as PluginContext, warn, checkInFindMany, userFindMany, checkInGroupBy };
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

describe('TeamService.filasYCobertura — el período en curso no cuenta horas que aún no pasaron (C2/C3)', () => {
  const AHORA = cr('2026-09-25T14:00:00'); // viernes de la semana en curso, 14:00 local

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
  });
  afterEach(() => vi.useRealTimers());

  it('con una sesión abierta, el total coincide EXACTO con el que calcularía /timesheet/office (index.ts:862) para la misma persona', async () => {
    // Cota de 3h desde las 08:00 -> 11:00, ANTES de "ahora" (14:00): la cota
    // sí llega a aplicarse, así que la prueba también cubre `openSessionCapped`.
    const capHours = 3;
    const checkInAt = cr('2026-09-25T08:00:00');
    const { ctx } = makeCtx({
      checkIns: [{ userId: 'u1', checkInAt, checkOutAt: null }],
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const [fila] = await makeService(ctx, capHours).filas(['u1'], 'week', AHORA);

    // Réplica EXACTA de la lógica de index.ts:862 -- /timesheet/office acota
    // `bounds.end` a "ahora" antes de cerrar la sesión abierta contra ese fin.
    const bounds = periodBounds(AHORA, 'week', TZ);
    const spanOficina = { start: bounds.start, end: bounds.end < AHORA ? bounds.end : AHORA };
    const sesionCerrada = { start: checkInAt, end: capOpenSession(checkInAt, spanOficina.end, capHours * 60) };
    const esperado = aggregateSessions([sesionCerrada], spanOficina, TZ).totalMinutes;

    expect(fila.totalMinutes).toBe(esperado);
    expect(fila.totalMinutes).toBe(180); // 08:00 a 11:00 (la cota, no las 6h transcurridas hasta "ahora")
    expect(fila.openSessionCapped).toBe(true);
  });

  it('con una sesión abierta DENTRO de la cota, el total es lo transcurrido hasta "ahora" -- no la cota entera', async () => {
    // Este es el caso que exponía C2: sin el fix, `capOpenSession` usaba
    // `currentBounds.end` (el domingo 23:59:59 de esta semana, en el futuro)
    // como límite, así que una sesión de la mañana se contaba hasta la cota
    // completa de 12h en vez de hasta "ahora" -- 720 min contra 360.
    const checkInAt = cr('2026-09-25T08:00:00'); // abierta desde las 08:00; "ahora" 14:00 -> 360 min transcurridos
    const { ctx } = makeCtx({
      checkIns: [{ userId: 'u1', checkInAt, checkOutAt: null }],
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const [fila] = await makeService(ctx, 12).filas(['u1'], 'week', AHORA);

    expect(fila.totalMinutes).toBe(360); // NO 720
    // La cota de 12h no llegó a aplicarse -- lo que se ve es "ahora", no la cota.
    expect(fila.openSessionCapped).toBe(false);
  });

  it('la cobertura no dibuja ningún día posterior a "hoy" dentro de la semana en curso', async () => {
    const { ctx } = makeCtx({
      checkIns: [{ userId: 'u1', checkInAt: cr('2026-09-21T08:00:00'), checkOutAt: cr('2026-09-21T09:00:00') }],
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const { cobertura } = await makeService(ctx).filasYCobertura(['u1'], 'week', AHORA);

    const hoyIso = '2026-09-25';
    expect(cobertura.fechas.every(f => f <= hoyIso)).toBe(true);
    // Sábado y domingo de esta misma semana: todavía no pasan.
    expect(cobertura.fechas).not.toContain('2026-09-26');
    expect(cobertura.fechas).not.toContain('2026-09-27');
  });

  it('un período enteramente pasado no cambia de comportamiento', async () => {
    const { ctx } = makeCtx({
      checkIns: [{ userId: 'u1', checkInAt: cr('2026-09-14T08:00:00'), checkOutAt: cr('2026-09-14T09:00:00') }],
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const anchorPasado = cr('2026-09-14T10:00:00'); // semana ya cerrada antes de "ahora" (25-sep)
    const { filas, cobertura } = await makeService(ctx).filasYCobertura(['u1'], 'week', anchorPasado);

    expect(filas[0].totalMinutes).toBe(60);
    // El domingo de esa semana (2026-09-20) ya pasó por completo: sigue
    // apareciendo en el mapa, igual que antes del fix.
    expect(cobertura.fechas).toContain('2026-09-14');
    expect(cobertura.fechas).toContain('2026-09-20');
  });

  it('la norma de los períodos previos (YA CERRADOS) no se acota a "ahora"', async () => {
    // Tres días previos COMPLETOS con 240 min cada uno. Si `totalesPrevios`
    // se acotara a "ahora" (14:00 del 25-sep) en vez de usar el Span propio
    // de cada período cerrado, no cambiaría nada acá -- son días enteros que
    // ya terminaron hace tiempo -- pero es justo la aritmética que un
    // refactor descuidado de C2 podría romper (acotar TODO a `efectivo` sin
    // distinguir período actual de períodos previos). La prueba fija el
    // número exacto para que ese descuido se note.
    const checkIns: CheckInRow[] = [
      { userId: 'u1', checkInAt: cr('2026-09-22T08:00:00'), checkOutAt: cr('2026-09-22T12:00:00') },
      { userId: 'u1', checkInAt: cr('2026-09-23T08:00:00'), checkOutAt: cr('2026-09-23T12:00:00') },
      { userId: 'u1', checkInAt: cr('2026-09-24T08:00:00'), checkOutAt: cr('2026-09-24T12:00:00') },
      { userId: 'u1', checkInAt: cr('2026-09-25T08:00:00'), checkOutAt: cr('2026-09-25T09:00:00') }, // hoy, 60 min
    ];
    const { ctx } = makeCtx({
      checkIns,
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const [fila] = await makeService(ctx).filas(['u1'], 'day', AHORA);

    // Norma = 240 (promedio de los 3 días previos, cada uno con 240 min
    // completos). Actual = 60. Si la norma se hubiera acotado a "ahora" con
    // el mismo criterio que el día actual, estos tres días -- ya cerrados
    // antes de "ahora" -- igual habrían dado 240 cada uno, así que este
    // número no cambia; lo que fija la prueba es que sea EXACTAMENTE 240 y
    // no otro valor si alguien conecta `efectivo` a `totalesPrevios`.
    expect(fila.totalMinutes).toBe(60);
    expect(fila.variacion).toEqual({
      tipo: 'calculada',
      pct: Math.round(((60 - 240) / 240) * 100),
      destacar: true,
    });
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
  it('no lanza: devuelve filas no-disponible, distintas de un sin-registrar real', async () => {
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
      // Los ceros son los mismos que los de un «sin registrar» real, pero el
      // estado NO puede serlo: «sin registrar» es un hecho sobre la persona y
      // «no disponible» es un hecho sobre el sistema. Confundirlos le atribuye
      // a alguien una conducta que no tuvo.
      expect(fila.estado).toBe('no-disponible');
      expect(fila.estado).not.toBe('sin-registrar');
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

describe('TeamService.filas — degrada si la consulta de nombres rechaza (I1)', () => {
  it('TODAS las filas salen no-disponible: ninguna con nombre vacío y minutos reales', async () => {
    // DESVÍO del comportamiento anterior a propósito (I1 en fix-A): antes esta
    // fila salía `estado: 'con-registro'`, `firstName: ''` y 60 minutos reales
    // -- un número real junto a un nombre en blanco, sin nada que avise de
    // quién es. `nombresPorUsuario` es una consulta DISTINTA de la de
    // sesiones, que sí funcionó; pero sin saber de quién es cada fila, esos
    // minutos no significan nada, y mostrarlos es peor que no mostrarlos.
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

    expect(fila.estado).toBe('no-disponible');
    expect(fila.totalMinutes).toBe(0);
    expect(fila.firstName).toBe('');
    expect(fila.ultimoDisponible).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('TeamService.excepciones — sin UUIDs crudos cuando los nombres fallan (I1)', () => {
  it('la franja de excepciones dice "no disponible" en vez de imprimir el userId', async () => {
    const { ctx, warn } = makeCtx({
      checkIns: [],
      rejectUsers: new Error('pool agotado'),
    });

    const { sinMarcar30Dias } = await makeService(ctx).excepciones(['u1']);

    expect(sinMarcar30Dias).toEqual([{ userId: 'u1', nombre: 'no disponible' }]);
    expect(sinMarcar30Dias.some(p => p.nombre === 'u1')).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

describe('TeamService.filasYCobertura — "último registro" no depende de la ventana de la norma (C1)', () => {
  it('una sesión anterior a la ventana de la norma igual reporta su fecha real, y NO "nunca"', async () => {
    // period: 'day' -> la ventana de la norma son 20 días hábiles previos a
    // la ancla, la más corta de las tres y donde el bug era más visible.
    // La única sesión de la persona queda MUY afuera de esa ventana.
    const ultimaVezVisto = cr('2026-07-01T08:00:00');
    const { ctx } = makeCtx({
      checkIns: [{ userId: 'u1', checkInAt: ultimaVezVisto, checkOutAt: cr('2026-07-01T09:00:00') }],
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const { filas } = await makeService(ctx).filasYCobertura(['u1'], 'day', cr('2026-09-21T10:00:00'));

    // Sin sesión DENTRO del período pedido, "sin-registrar" sigue siendo
    // cierto -- lo que no puede pasar es que "último" mienta.
    expect(filas[0].estado).toBe('sin-registrar');
    expect(filas[0].ultimoDisponible).toBe(true);
    expect(filas[0].ultimoRegistro).toBe('2026-07-01');
    expect(filas[0].ultimoRegistro).not.toBeNull();
  });

  it('si la consulta de "último registro" rechaza, las filas conservan sus minutos y quedan con ultimoDisponible: false', async () => {
    const sesion: CheckInRow = {
      userId: 'u1',
      checkInAt: cr('2026-09-21T08:00:00'),
      checkOutAt: cr('2026-09-21T09:00:00'),
    };
    const { ctx, warn } = makeCtx({
      checkIns: [sesion],
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
      rejectUltimo: new Error('conexión perdida'),
    });

    const [fila] = await makeService(ctx).filas(['u1'], 'day', cr('2026-09-21T10:00:00'));

    // No se cae ni inventa "nunca": los minutos de la sesión (que SÍ se pudo
    // leer) siguen de pie, y solo la columna de "último" se apaga.
    expect(fila.estado).toBe('con-registro');
    expect(fila.totalMinutes).toBe(60);
    expect(fila.ultimoDisponible).toBe(false);
    expect(fila.ultimoRegistro).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe('TeamService.filasYCobertura — filas y cobertura salen del mismo query', () => {
  it('devuelve la misma fila que filas() y una cobertura consistente con esa sesión', async () => {
    const sesion: CheckInRow = {
      userId: 'u1',
      checkInAt: cr('2026-09-21T08:00:00'),
      checkOutAt: cr('2026-09-21T09:00:00'),
    };
    const { ctx } = makeCtx({
      checkIns: [sesion],
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const { filas, cobertura } = await makeService(ctx).filasYCobertura(['u1'], 'day', cr('2026-09-21T10:00:00'));

    expect(filas).toHaveLength(1);
    expect(filas[0].totalMinutes).toBe(60);
    expect(cobertura.celdas).toEqual([{ fecha: '2026-09-21', hora: 8, personas: 1 }]);
  });

  it('sin userIds no consulta nada y devuelve cobertura vacía', async () => {
    const { ctx, checkInFindMany } = makeCtx();

    const { filas, cobertura } = await makeService(ctx).filasYCobertura([], 'week', cr('2026-09-21T10:00:00'));

    expect(filas).toEqual([]);
    expect(cobertura).toEqual({ horaMin: 0, horaMax: 0, fechas: [], celdas: [] });
    expect(checkInFindMany).not.toHaveBeenCalled();
  });

  it('si la consulta de sesiones rechaza, la cobertura queda vacía en vez de inventar datos', async () => {
    const { ctx } = makeCtx({
      rejectCheckIns: new Error('conexión perdida'),
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const { cobertura } = await makeService(ctx).filasYCobertura(['u1'], 'week', cr('2026-09-21T10:00:00'));

    expect(cobertura).toEqual({ horaMin: 0, horaMax: 0, fechas: [], celdas: [] });
  });
});

describe('TeamService.filasYCobertura — la sesión abierta se acota ANTES de entrar en la cobertura', () => {
  it('una sesión sin marcar salida no pinta cobertura más allá de la cota configurada', async () => {
    const { ctx } = makeCtx({
      checkIns: [{ userId: 'u1', checkInAt: cr('2026-09-21T08:00:00'), checkOutAt: null }],
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    // Cota de 2 horas desde las 08:00 local -> 10:00. Sin la cota, una
    // sesión olvidada pintaría cobertura de personas: 1 en las 24 horas del
    // día -- el mismo defecto que ya se resolvió para `totalMinutes`.
    const { cobertura } = await makeService(ctx, 2).filasYCobertura(['u1'], 'day', cr('2026-09-21T10:00:00'));

    expect(cobertura.horaMin).toBe(8);
    expect(cobertura.horaMax).toBe(9);
    expect(cobertura.celdas.some(c => c.hora >= 10)).toBe(false);
  });
});

describe('TeamService.excepciones — RECHAZA en vez de inventar un vacío', () => {
  it('propaga el fallo de la consulta, no devuelve listas vacías', async () => {
    // Cambio de contrato de la Task 9, y es el más riesgoso de la entrega:
    // antes degradaba sola a `{ sinMarcar30Dias: [], sesionesAbiertas: [] }`.
    // Ese vacío es un «cero inventado»: en la pantalla de Cumplimiento se
    // leería como «no hay nadie sin marcar», que es la mentira más cara
    // posible ahí. Ahora rechaza y cada llamador decide — `/timesheet/team`
    // le pone su `.catch` para conservar el degrade que ya tenía revisado, y
    // `ComplianceService` lo refleja como `null` («no disponible»).
    const { ctx, warn } = makeCtx({
      rejectCheckIns: new Error('relation "check_in_records" does not exist'),
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    await expect(makeService(ctx).excepciones(['u1'])).rejects.toThrow(/check_in_records/);
    // Y no lo silencia con un warning propio: quien lo atrape decide qué decir.
    expect(warn).not.toHaveBeenCalled();
  });
});
