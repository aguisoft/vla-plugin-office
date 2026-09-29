import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TeamService } from './team.service';
import type { PluginContext } from '@vla/plugin-sdk';
import type { OrgService, RosterEntry } from './org.service';
import type { HolidayService } from './holiday.service';
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
  /**
   * Doble de `groupBy` para `ultimoRegistroPorUsuario` (C1).
   *
   * **Aplica el `where` que recibe**, y eso es el punto: el contrato de esa
   * consulta es que NO tenga cota de fechas, porque una ventana ahí es lo que
   * fabricaba el «nunca». Un doble que ignore sus argumentos devolvería la
   * fecha correcta aunque alguien le volviera a poner la cota, y la prueba que
   * guarda ese contrato pasaría sin probar nada — que es exactamente lo que
   * pasaba con el doble de `findMany` antes de arreglarlo.
   */
  const checkInGroupBy = vi.fn(async (args?: any) => {
    if (opts.rejectUltimo) throw opts.rejectUltimo;
    const where = args?.where ?? {};
    const ids: string[] | undefined = where.userId?.in;
    const desde: Date | undefined = where.checkInAt?.gte;
    const hasta: Date | undefined = where.checkInAt?.lte;

    const fuente = (opts.ultimos ?? opts.checkIns ?? []).filter(r =>
      (!ids || ids.includes(r.userId)) &&
      (!desde || r.checkInAt >= desde) &&
      (!hasta || r.checkInAt <= hasta));

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

/**
 * Doble mínimo de `OrgService` para I5: por omisión nadie tiene país
 * resuelto (`roster` vacío), así que `feriadosPorUsuario` no descuenta nada
 * y el comportamiento es idéntico al de antes de I5 -- las pruebas que no
 * mencionan feriados no necesitan saber que este doble existe.
 */
function fakeOrg(opts: { roster?: Map<string, Partial<RosterEntry>>; reject?: Error } = {}): OrgService {
  return {
    roster: vi.fn(async () => {
      if (opts.reject) throw opts.reject;
      return opts.roster ?? new Map();
    }),
  } as unknown as OrgService;
}

/**
 * Doble de `HolidayService` para I5. Por omisión, sin feriados cargados.
 *
 * **Simula el rango de la consulta**, no solo devuelve lo que se le pone. Un
 * doble que ignora sus argumentos no puede detectar un `WHERE` mal armado, y
 * eso ya pasó dos veces en este plan: el de `checkInRecord.findMany` hizo que
 * el bug de «último: nunca» fuera irreproducible en una prueba, y este mismo
 * dejó pasar un rango que perdía el feriado del primer día del período.
 *
 * `Holiday.date` es una columna DATE: Prisma la entrega a medianoche UTC, así
 * que el filtro se evalúa contra ese instante, igual que en la base real.
 */
function fakeHolidays(opts: { porPais?: Map<string, Set<string>>; reject?: Error } = {}): HolidayService {
  return {
    datesByCountry: vi.fn(async (countries: string[], from: Date, to: Date) => {
      if (opts.reject) throw opts.reject;
      const todos = opts.porPais ?? new Map<string, Set<string>>();
      const out = new Map<string, Set<string>>();
      for (const [pais, fechas] of todos) {
        if (!countries.includes(pais)) continue;
        const dentro = new Set<string>();
        for (const fecha of fechas) {
          const instante = new Date(`${fecha}T00:00:00Z`);
          if (instante >= from && instante <= to) dentro.add(fecha);
        }
        if (dentro.size > 0) out.set(pais, dentro);
      }
      return out;
    }),
  } as unknown as HolidayService;
}

function makeService(
  ctx: PluginContext,
  capHours = 12,
  org: OrgService = fakeOrg(),
  holidays: HolidayService = fakeHolidays(),
) {
  return new TeamService(ctx, () => TZ, () => capHours, org, holidays);
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

  it('los períodos previos se acotan al MISMO offset transcurrido, no a "ahora"', async () => {
    // Título corregido tras I4: los previos SÍ se acotan, pero a
    // `inicio + transcurrido`, no al instante «ahora». La diferencia importa:
    // acotar a «ahora» dejaría a cada período previo con su duración entera
    // (ya terminaron), y entonces un lunes a las 10am se compararía media
    // jornada contra jornadas completas — la flecha roja para todo el equipo
    // que I4 vino a quitar.
    //
    // Acá las sesiones previas cierran a las 12:00 y «ahora» son las 14:00,
    // así que el recorte por offset no muerde y los tres previos aportan sus
    // 240 minutos completos. Lo que la prueba fija es que el ACTUAL no
    // contamine la norma.
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

describe('TeamService.filasYCobertura — I4: la norma compara el MISMO punto transcurrido, no el período previo entero', () => {
  const AHORA = cr('2026-09-24T12:00:00'); // jueves, mitad de la semana en curso (12:00 de 7 días = 50%)

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
  });
  afterEach(() => vi.useRealTimers());

  /** Siete sesiones cerradas de 08:00 a 16:00 (480 min), lunes a domingo. */
  function semanaCompleta(mondayIso: string): CheckInRow[] {
    const out: CheckInRow[] = [];
    const monday = new Date(`${mondayIso}T00:00:00Z`);
    for (let i = 0; i < 7; i++) {
      const fecha = new Date(monday.getTime() + i * 86_400_000).toISOString().slice(0, 10);
      out.push({ userId: 'u1', checkInAt: cr(`${fecha}T08:00:00`), checkOutAt: cr(`${fecha}T16:00:00`) });
    }
    return out;
  }

  it('al 50% de la semana con la mitad de los minutos, la variación es ≈0% -- NO -50%', async () => {
    // La semana en curso (lunes 21 a jueves 24 mediodía, lo único que pasó)
    // repite el MISMO patrón de 08:00-16:00 que las tres semanas previas,
    // pero solo hasta "ahora" -- la de hoy queda abierta y se acota a las
    // 12:00 por el mecanismo de C2/C3, no por este fix. Si `totalesPrevios`
    // siguiera usando el período previo ENTERO (7 días x 480min = 3360),
    // 1680 contra 3360 da exactamente -50% -- el bug que describe I4. Con el
    // fix, cada previo se acota a sus primeras 3.5 días (el mismo punto
    // relativo), y da 1680 igual: ~0%.
    const checkIns: CheckInRow[] = [
      { userId: 'u1', checkInAt: cr('2026-09-21T08:00:00'), checkOutAt: cr('2026-09-21T16:00:00') }, // lunes
      { userId: 'u1', checkInAt: cr('2026-09-22T08:00:00'), checkOutAt: cr('2026-09-22T16:00:00') }, // martes
      { userId: 'u1', checkInAt: cr('2026-09-23T08:00:00'), checkOutAt: cr('2026-09-23T16:00:00') }, // miércoles
      { userId: 'u1', checkInAt: cr('2026-09-24T08:00:00'), checkOutAt: null }, // jueves, hoy, abierta
      ...semanaCompleta('2026-09-14'), // semana previa -1
      ...semanaCompleta('2026-09-07'), // semana previa -2
      ...semanaCompleta('2026-08-31'), // semana previa -3
    ];
    const { ctx } = makeCtx({
      checkIns,
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const [fila] = await makeService(ctx).filas(['u1'], 'week', AHORA);

    expect(fila.totalMinutes).toBe(1680); // 3 días completos (1440) + jueves acotado a "ahora" (240)
    expect(fila.variacion).toEqual({ tipo: 'calculada', pct: 0, destacar: false });
  });

  it('un período previo YA CERRADO y más CORTO que el actual no se acota más allá de su propio fin (fuga entre meses)', async () => {
    // Guarda del `Math.min(p.start + transcurrido, p.end)`. `transcurrido` se
    // calcula sobre MARZO (31 días); febrero, el previo inmediato, tiene
    // solo 28 (año no bisiesto). Sin el `Math.min`, `p.start + transcurrido`
    // para febrero cae el 3 de marzo -- DESPUÉS del propio fin de febrero --
    // y la sesión del 2 de marzo (que es de MARZO, el período ACTUAL) se
    // colaría dentro de la "norma" de febrero, inflándola.
    //
    // Se corre el reloj más allá de marzo (el `beforeEach` de este describe
    // lo deja a mitad de la semana del 24-sep) para que marzo quede YA
    // CERRADO y `transcurrido` cubra su duración completa -- el escenario
    // exacto en el que la fuga ocurriría si faltara el `Math.min`.
    vi.setSystemTime(cr('2027-04-05T10:00:00'));
    const anclaMarzo = cr('2027-03-15T10:00:00');
    const checkIns: CheckInRow[] = [
      // Marzo: única sesión del período actual, y el cebo de la fuga si el
      // `Math.min` faltara.
      { userId: 'u1', checkInAt: cr('2027-03-02T08:00:00'), checkOutAt: cr('2027-03-02T09:00:00') },
      // Febrero (28 días, MÁS CORTO que marzo): su propia sesión, la única
      // que debe contar en su norma.
      { userId: 'u1', checkInAt: cr('2027-02-01T08:00:00'), checkOutAt: cr('2027-02-01T09:00:00') },
      // Enero y diciembre (31 días cada uno, IGUAL que marzo): sin riesgo de
      // fuga, solo para llegar al mínimo de 3 períodos que exige `variacion`.
      { userId: 'u1', checkInAt: cr('2027-01-01T08:00:00'), checkOutAt: cr('2027-01-01T09:00:00') },
      { userId: 'u1', checkInAt: cr('2026-12-01T08:00:00'), checkOutAt: cr('2026-12-01T09:00:00') },
    ];
    const { ctx } = makeCtx({
      checkIns,
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const [fila] = await makeService(ctx).filas(['u1'], 'month', anclaMarzo);

    expect(fila.totalMinutes).toBe(60); // marzo, ya cerrado: su única sesión
    // Norma = 60 (Feb, Ene, Dic, los tres con 60 min reales cada uno) ->
    // variación 0%. Con la fuga (sin `Math.min`), Feb saldría en 120 y la
    // norma en 80, dando -25% -- la prueba lo distingue explícitamente.
    expect(fila.variacion).toEqual({ tipo: 'calculada', pct: 0, destacar: false });
  });
});

describe('TeamService.filasYCobertura — I5: feriados por país en el denominador de "N de M días"', () => {
  const ANCLA = cr('2026-09-21T10:00:00'); // semana lunes 21 a domingo 27 de setiembre

  it('un feriado en LUNES —el primer día del período— también se descuenta', async () => {
    // El caso que el rango viejo perdía. `Holiday.date` es una columna DATE y
    // llega a medianoche UTC; `currentBounds.start` es medianoche LOCAL, que en
    // UTC−6 son las 06:00Z. Con el `gte` contra el instante local, el feriado
    // del primer día quedaba siempre afuera: en la vista «Día» no se descontaba
    // ninguno, y en la semanal se perdían los de lunes. En Costa Rica eso no es
    // marginal — la Ley 9875 traslada varios feriados a ese día.
    const { ctx } = makeCtx({
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });
    const roster = new Map<string, Partial<RosterEntry>>([['u1', { country: 'CR' }]]);
    const porPais = new Map([['CR', new Set(['2026-09-21'])]]); // el lunes mismo

    const svc = makeService(ctx, 12, fakeOrg({ roster }), fakeHolidays({ porPais }));
    const [fila] = await svc.filas(['u1'], 'week', ANCLA);

    expect(fila.diasHabiles).toBe(4);
  });

  it('en la vista de un solo DÍA, el feriado deja el denominador en cero', async () => {
    // El período de un día empieza y termina el mismo día, así que el feriado
    // es SIEMPRE el primer día: con el rango viejo, la vista diaria no
    // descontaba feriados nunca y decía que había jornada que cumplir.
    const { ctx } = makeCtx({
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });
    const roster = new Map<string, Partial<RosterEntry>>([['u1', { country: 'CR' }]]);
    const porPais = new Map([['CR', new Set(['2026-09-21'])]]);

    const svc = makeService(ctx, 12, fakeOrg({ roster }), fakeHolidays({ porPais }));
    const [fila] = await svc.filas(['u1'], 'day', ANCLA);

    expect(fila.diasHabiles).toBe(0);
  });

  it('un feriado del país de la persona baja SU diasHabiles; a otro país no le toca', async () => {
    const { ctx } = makeCtx({
      users: [
        { id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' },
        { id: 'u2', firstName: 'Beto', lastName: 'Solís', email: 'beto@vla.com' },
      ],
    });
    const roster = new Map<string, Partial<RosterEntry>>([
      ['u1', { country: 'CR' }],
      ['u2', { country: 'AR' }],
    ]);
    // Miércoles 23-sep feriado, pero SOLO en Costa Rica.
    const porPais = new Map([['CR', new Set(['2026-09-23'])]]);

    const svc = makeService(ctx, 12, fakeOrg({ roster }), fakeHolidays({ porPais }));
    const filas = await svc.filas(['u1', 'u2'], 'week', ANCLA);

    expect(filas.find(f => f.userId === 'u1')!.diasHabiles).toBe(4);
    expect(filas.find(f => f.userId === 'u2')!.diasHabiles).toBe(5);
  });

  it('sin feriados cargados, diasHabiles no cambia respecto de antes de I5', async () => {
    const { ctx } = makeCtx({ users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }] });

    const [fila] = await makeService(ctx).filas(['u1'], 'week', ANCLA);

    expect(fila.diasHabiles).toBe(5);
  });

  it('si el organigrama (país) no se pudo leer, NO se descuenta nada y se loguea', async () => {
    const { ctx, warn } = makeCtx({ users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }] });
    const org = fakeOrg({ reject: new Error('conexión perdida') });

    const [fila] = await makeService(ctx, 12, org, fakeHolidays()).filas(['u1'], 'week', ANCLA);

    // Un denominador generoso (sin descontar) es menos dañino que apagar la
    // pantalla entera -- pero el fallo queda logueado para que no pase
    // desapercibido según el país de las personas.
    expect(fila.diasHabiles).toBe(5);
    expect(warn).toHaveBeenCalled();
  });

  it('si el catálogo de feriados (no el organigrama) rechaza, tampoco se descuenta nada', async () => {
    const { ctx, warn } = makeCtx({ users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }] });
    const roster = new Map<string, Partial<RosterEntry>>([['u1', { country: 'CR' }]]);
    const holidays = fakeHolidays({ reject: new Error('relation "holidays" does not exist') });

    const [fila] = await makeService(ctx, 12, fakeOrg({ roster }), holidays).filas(['u1'], 'week', ANCLA);

    expect(fila.diasHabiles).toBe(5);
    expect(warn).toHaveBeenCalled();
  });
});

describe('TeamService.filasYCobertura — I6/N2: el numerador sale del mismo universo que el denominador', () => {
  it('quien trabajó un sábado no infla el numerador en silencio: se reporta aparte', async () => {
    const checkIns: CheckInRow[] = [
      { userId: 'u1', checkInAt: cr('2026-09-21T08:00:00'), checkOutAt: cr('2026-09-21T09:00:00') }, // lunes
      { userId: 'u1', checkInAt: cr('2026-09-26T08:00:00'), checkOutAt: cr('2026-09-26T09:00:00') }, // sábado
    ];
    const { ctx } = makeCtx({
      checkIns,
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const [fila] = await makeService(ctx).filas(['u1'], 'week', cr('2026-09-21T10:00:00'));

    // "1 de 5", no "2 de 5": el numerador cuenta solo los días hábiles.
    expect(fila.diasConRegistro).toBe(1);
    expect(fila.diasHabiles).toBe(5);
    // El sábado no se esconde: se reporta aparte.
    expect(fila.diasFueraDeHabiles).toBe(1);
  });

  it('un FERIADO trabajado entre semana tampoco invierte la fracción (N2)', async () => {
    // El caso que reabría el «7/5» con otra causa: `diasHabiles` resta los
    // feriados desde I5, pero el numerador solo restaba fines de semana. Quien
    // trabajaba el feriado producía «5/4» — más días trabajados que días
    // hábiles, que se lee como un error del sistema.
    // Es un caso vivo: el 15-sep-2026 (martes) ya está cargado en producción.
    const checkIns: CheckInRow[] = [
      { userId: 'u1', checkInAt: cr('2026-09-21T08:00:00'), checkOutAt: cr('2026-09-21T09:00:00') }, // lunes
      { userId: 'u1', checkInAt: cr('2026-09-22T08:00:00'), checkOutAt: cr('2026-09-22T09:00:00') }, // martes
      { userId: 'u1', checkInAt: cr('2026-09-23T08:00:00'), checkOutAt: cr('2026-09-23T09:00:00') }, // miércoles: FERIADO
    ];
    const { ctx } = makeCtx({
      checkIns,
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });
    const roster = new Map<string, Partial<RosterEntry>>([['u1', { country: 'CR' }]]);
    const porPais = new Map([['CR', new Set(['2026-09-23'])]]);

    const svc = makeService(ctx, 12, fakeOrg({ roster }), fakeHolidays({ porPais }));
    const [fila] = await svc.filas(['u1'], 'week', cr('2026-09-21T10:00:00'));

    // "2 de 4", nunca "3 de 4": el feriado sale de los dos lados.
    expect(fila.diasConRegistro).toBe(2);
    expect(fila.diasHabiles).toBe(4);
    expect(fila.diasConRegistro).toBeLessThanOrEqual(fila.diasHabiles);
    // Y el día trabajado en feriado no se pierde: se reporta aparte.
    expect(fila.diasFueraDeHabiles).toBe(1);
  });

  it('sin días fuera de jornada, el contador aparte queda en cero', async () => {
    const checkIns: CheckInRow[] = [
      { userId: 'u1', checkInAt: cr('2026-09-21T08:00:00'), checkOutAt: cr('2026-09-21T09:00:00') },
    ];
    const { ctx } = makeCtx({
      checkIns,
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const [fila] = await makeService(ctx).filas(['u1'], 'week', cr('2026-09-21T10:00:00'));

    expect(fila.diasFueraDeHabiles).toBe(0);
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

describe('TeamService.filas — N5: sin nombre no hay fila con números', () => {
  it('una persona ausente del mapa de nombres sale no-disponible, no anónima con minutos', async () => {
    // La consulta de nombres funcionó, pero no trajo a u2. Antes, u2 salía con
    // firstName/lastName/email en blanco, estado con-registro y sus minutos
    // reales: una fila anónima con números, que es el mismo defecto que I1
    // cerró para el fallo TOTAL de la consulta, en pequeño. Sin saber de quién
    // son, los minutos no significan nada.
    const checkIns: CheckInRow[] = [
      { userId: 'u1', checkInAt: cr('2026-09-21T08:00:00'), checkOutAt: cr('2026-09-21T12:00:00') },
      { userId: 'u2', checkInAt: cr('2026-09-21T08:00:00'), checkOutAt: cr('2026-09-21T12:00:00') },
    ];
    const { ctx, warn } = makeCtx({
      checkIns,
      // u2 NO está en la lista de usuarios: la consulta respondió sin él.
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const filas = await makeService(ctx).filas(['u1', 'u2'], 'week', cr('2026-09-21T10:00:00'));

    const conNombre = filas.find(f => f.userId === 'u1')!;
    expect(conNombre.estado).toBe('con-registro');
    expect(conNombre.totalMinutes).toBeGreaterThan(0);

    const sinNombre = filas.find(f => f.userId === 'u2')!;
    expect(sinNombre.estado).toBe('no-disponible');
    expect(sinNombre.totalMinutes).toBe(0);
    // Y deja rastro: el fallo por persona no puede pasar en silencio.
    expect(warn).toHaveBeenCalled();
  });
});

describe('TeamService.filasYCobertura — N4: un período futuro no afirma nada sobre nadie', () => {
  const AHORA_N4 = cr('2026-09-25T12:00:00');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA_N4);
  });
  afterEach(() => vi.useRealTimers());

  it('la semana siguiente devuelve cero filas y lo marca, no 22 «sin registrar»', async () => {
    // Se llega con un clic en «›». Sin el corte, `efectivo` queda invertido,
    // todo da cero y estadoRegistro devuelve `sin-registrar` para todo el
    // mundo: la tabla afirmaría que nadie marcó entrada en una semana que aún
    // no ocurrió.
    const { ctx } = makeCtx({
      checkIns: [{ userId: 'u1', checkInAt: cr('2026-09-24T08:00:00'), checkOutAt: cr('2026-09-24T12:00:00') }],
      users: [
        { id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' },
        { id: 'u2', firstName: 'Beto', lastName: 'Solís', email: 'beto@vla.com' },
      ],
    });

    const r = await makeService(ctx).filasYCobertura(['u1', 'u2'], 'week', cr('2026-10-05T10:00:00'));

    expect(r.periodoFuturo).toBe(true);
    expect(r.filas).toEqual([]);
    expect(r.cobertura.fechas).toEqual([]);
  });

  it('la semana EN CURSO no se marca como futura', async () => {
    const { ctx } = makeCtx({
      users: [{ id: 'u1', firstName: 'Ana', lastName: 'Pérez', email: 'ana@vla.com' }],
    });

    const r = await makeService(ctx).filasYCobertura(['u1'], 'week', AHORA_N4);

    expect(r.periodoFuturo).toBeUndefined();
    expect(r.filas).toHaveLength(1);
  });
});
