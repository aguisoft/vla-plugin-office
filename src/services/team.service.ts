import type { PluginContext } from '@vla/plugin-sdk';
import {
  periodBounds, capOpenSession, aggregateSessions, clipSpan, type Period, type Span,
} from '../lib/timesheet';
import {
  estadoRegistro, diasConRegistro, diasHabiles, computeNorm, PERIODOS_NORMA, variacion,
  entradaHabitual, type EstadoRegistro, type Variacion,
} from '../lib/team-stats';
import { localDateString } from '../lib/local-date';

/**
 * Estado de una fila de la tabla, con un valor MÁS que la lógica pura.
 *
 * `EstadoRegistro` responde «¿marcó o no?» sobre sesiones que sí se pudieron
 * leer. Acá hace falta un tercer valor para «no se pudo leer», porque si una
 * falla de base se presenta como `sin-registrar`, el jefe ve exactamente lo
 * mismo que vería si la persona no hubiera marcado, y no tiene manera de
 * distinguirlo. Es el mismo error que ya se corrigió en el desglose por estado
 * con `breakdownUnavailable`: un fallo de infraestructura dibujado como un dato
 * sobre una persona.
 */
export type EstadoFila = EstadoRegistro | 'no-disponible';

export interface FilaEquipo {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  estado: EstadoFila;
  totalMinutes: number;
  openSessionCapped: boolean;
  variacion: Variacion;
  diasConRegistro: number;
  diasHabiles: number;
  entradaHabitual: string | null;
  /** YYYY-MM-DD local. */
  ultimoRegistro: string | null;
}

export interface Excepciones {
  sinMarcar30Dias: Array<{ userId: string; nombre: string }>;
  sesionesAbiertas: Array<{ userId: string; nombre: string; desde: string }>;
}

type CheckInRow = { userId: string; checkInAt: Date; checkOutAt: Date | null };
interface NombreInfo { firstName: string; lastName: string; email: string }

/** Ventana para "no ha marcado en N días" en `excepciones`. */
const DIAS_SIN_MARCAR = 30;

export class TeamService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly tzOf: () => string,
    private readonly maxOpenSessionHoursOf: () => number,
  ) {}

  /**
   * Nombre y correo de cada persona, desde la tabla de usuarios del core.
   *
   * No sale de `OrgService.roster`: esa consulta resuelve país, departamento
   * y jefe, ninguno de los cuales aparece en `FilaEquipo`. El nombre viene de
   * `ctx.prisma.user`, igual que `SnapshotService.getAll` y `GET /org/roster`.
   *
   * Degrada a un mapa vacío si la consulta falla: un nombre en blanco no le
   * impide a la fila reportar sus minutos, y en Express 4 un rechazo de
   * promesa sin atrapar mata el proceso entero.
   */
  private async nombresPorUsuario(userIds: string[]): Promise<Map<string, NombreInfo>> {
    try {
      const rows = await this.ctx.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      return new Map((rows as any[]).map(u => [
        u.id,
        { firstName: u.firstName, lastName: u.lastName, email: u.email },
      ]));
    } catch (e) {
      this.ctx.logger.warn(`TeamService: no se pudieron leer los nombres de usuario: ${e}`);
      return new Map();
    }
  }

  /**
   * Los `n` períodos anteriores al que contiene `anchor`, del más al menos
   * reciente. Se apoya en `periodBounds` en vez de sumar/restar días a mano:
   * es la misma función que ya resuelve semanas que empiezan lunes y meses de
   * distinta longitud, así que caminar hacia atrás con ella no puede
   * desacordarse con el período "actual" que ve el resto del servicio.
   */
  private periodosAnteriores(anchor: Date, period: Period, tz: string, n: number): Span[] {
    const out: Span[] = [];
    let ref = periodBounds(anchor, period, tz);
    for (let i = 0; i < n; i++) {
      const anclaPrevia = new Date(ref.start.getTime() - 1);
      ref = periodBounds(anclaPrevia, period, tz);
      out.push(ref);
    }
    return out;
  }

  /**
   * Trae `CheckInRecord` de todo `userIds` para toda la ventana (la norma
   * más el período actual) en una sola consulta. `null` si la consulta falla
   * -- distinto de `[]`, que significa "no hay filas" -- para que el
   * llamador sepa que no puede confiar en nada de lo que hubiera calculado.
   *
   * El try/catch no es opcional: Express 4 no atrapa un rechazo de promesa
   * en un handler async, así que una tabla ausente acá tumbaría el proceso
   * entero del API, no solo este endpoint.
   */
  private async checkInsDelEquipo(
    userIds: string[],
    queryStart: Date,
    queryEnd: Date,
  ): Promise<CheckInRow[] | null> {
    try {
      const rows = await this.ctx.prisma.checkInRecord.findMany({
        where: {
          userId: { in: userIds },
          checkInAt: { lte: queryEnd },
          OR: [{ checkOutAt: null }, { checkOutAt: { gte: queryStart } }],
        },
        select: { userId: true, checkInAt: true, checkOutAt: true },
        orderBy: { checkInAt: 'asc' },
      });
      return rows as CheckInRow[];
    } catch (e) {
      this.ctx.logger.warn(`TeamService.filas: no se pudo leer CheckInRecord: ${e}`);
      return null;
    }
  }

  /**
   * Fila de respaldo cuando la consulta de sesiones falla.
   *
   * Va con `estado: 'no-disponible'` y no con `'sin-registrar'`: los dos casos
   * producen los mismos ceros, pero significan cosas opuestas. «Sin registrar»
   * es un hecho sobre la persona —no marcó— y «no disponible» es un hecho sobre
   * el sistema. Mostrar el primero cuando pasó el segundo le atribuye a alguien
   * una conducta que no tuvo, que es justo lo que este tablero existe para
   * evitar.
   *
   * `diasHabiles` es la excepción y se conserva: no depende de la consulta que
   * falló, así que sigue siendo el calendario real y no otro cero sin explicar.
   */
  private filaSinConsulta(userId: string, nombres: Map<string, NombreInfo>, diasHabilesPeriodo: number): FilaEquipo {
    const nombre = nombres.get(userId);
    return {
      userId,
      firstName: nombre?.firstName ?? '',
      lastName: nombre?.lastName ?? '',
      email: nombre?.email ?? '',
      estado: 'no-disponible',
      totalMinutes: 0,
      openSessionCapped: false,
      variacion: { tipo: 'sin-base' },
      diasConRegistro: 0,
      diasHabiles: diasHabilesPeriodo,
      entradaHabitual: null,
      ultimoRegistro: null,
    };
  }

  /**
   * Filas del equipo para el período que contiene `anchor`.
   *
   * Una sola consulta trae `CheckInRecord` de todo `userIds` desde el inicio
   * del período más antiguo de la norma hasta el fin del período actual, y el
   * reparto por persona y por período se hace en memoria: con 22 personas y
   * miles de filas históricas, una consulta por persona serían 22 viajes a la
   * base en vez de uno.
   */
  async filas(userIds: string[], period: Period, anchor: Date): Promise<FilaEquipo[]> {
    if (userIds.length === 0) return [];

    const tz = this.tzOf();
    const capHours = this.maxOpenSessionHoursOf();
    const currentBounds = periodBounds(anchor, period, tz);
    const diasHabilesPeriodo = diasHabiles(currentBounds, tz).length;

    const periodosPrevios = this.periodosAnteriores(anchor, period, tz, PERIODOS_NORMA[period]);
    const ventanaNorma: Span = {
      start: periodosPrevios[periodosPrevios.length - 1].start,
      end: periodosPrevios[0].end,
    };

    const nombres = await this.nombresPorUsuario(userIds);
    const rows = await this.checkInsDelEquipo(userIds, ventanaNorma.start, currentBounds.end);

    if (rows === null) {
      return userIds.map(userId => this.filaSinConsulta(userId, nombres, diasHabilesPeriodo));
    }

    const byUser = new Map<string, Span[]>();
    const acotadas = new Set<string>();
    const ultimoPorUsuario = new Map<string, Date>();
    // userId -> (fecha local -> primera entrada de ese día), solo dentro de
    // la ventana de la norma. `entradaHabitual` recibe una entrada por día,
    // no todas las sesiones.
    const entradasPorDia = new Map<string, Map<string, Date>>();

    for (const r of rows) {
      const ultimoActual = ultimoPorUsuario.get(r.userId);
      if (!ultimoActual || r.checkInAt > ultimoActual) ultimoPorUsuario.set(r.userId, r.checkInAt);

      if (r.checkInAt >= ventanaNorma.start && r.checkInAt <= ventanaNorma.end) {
        const dia = localDateString(r.checkInAt, tz);
        const porDia = entradasPorDia.get(r.userId) ?? new Map<string, Date>();
        const existente = porDia.get(dia);
        if (!existente || r.checkInAt < existente) porDia.set(dia, r.checkInAt);
        entradasPorDia.set(r.userId, porDia);
      }

      let end: Date;
      if (r.checkOutAt) {
        end = r.checkOutAt;
      } else {
        end = capOpenSession(r.checkInAt, currentBounds.end, capHours * 60);
        // Solo cuenta si el tramo YA ACOTADO toca el período actual (mismo
        // chequeo que TimesheetService.officeTime): una sesión abierta vieja
        // que la cota deja fuera del período no debería decir que lo acotó.
        if (end < currentBounds.end && clipSpan({ start: r.checkInAt, end }, currentBounds)) {
          acotadas.add(r.userId);
        }
      }

      const lista = byUser.get(r.userId) ?? [];
      lista.push({ start: r.checkInAt, end });
      byUser.set(r.userId, lista);
    }

    return userIds.map(userId => {
      const sesiones = byUser.get(userId) ?? [];
      const totalActual = aggregateSessions(sesiones, currentBounds, tz).totalMinutes;
      // La norma se calcula SOLO sobre los períodos anteriores: el actual
      // nunca entra en `totalesPrevios`, para no compararlo contra sí mismo.
      const totalesPrevios = periodosPrevios.map(p => aggregateSessions(sesiones, p, tz).totalMinutes);
      const norma = computeNorm(totalesPrevios);
      const nombre = nombres.get(userId);
      const ultimo = ultimoPorUsuario.get(userId);
      const primerasEntradas = [...(entradasPorDia.get(userId)?.values() ?? [])];

      return {
        userId,
        firstName: nombre?.firstName ?? '',
        lastName: nombre?.lastName ?? '',
        email: nombre?.email ?? '',
        estado: estadoRegistro(sesiones, currentBounds),
        totalMinutes: totalActual,
        openSessionCapped: acotadas.has(userId),
        variacion: variacion(totalActual, norma),
        diasConRegistro: diasConRegistro(sesiones, currentBounds, tz).length,
        diasHabiles: diasHabilesPeriodo,
        entradaHabitual: entradaHabitual(primerasEntradas, tz),
        // Sin acotar al período: responde "¿cuándo se le vio por última vez?"
        // con el checkInAt crudo más reciente de la ventana consultada, no el
        // que sobrevive a clipSpan -- eso ya lo cubre diasConRegistro.
        ultimoRegistro: ultimo ? localDateString(ultimo, tz) : null,
      };
    });
  }

  /**
   * Excepciones del equipo: quién no ha marcado en `DIAS_SIN_MARCAR` días y
   * quién tiene una sesión abierta más vieja que la cota configurada.
   *
   * No recibe período ni ancla -- a diferencia de `filas()`, mira el
   * historial reciente completo, no una ventana de norma -- así que arma su
   * propia consulta en vez de reusar la de `filas()`.
   */
  async excepciones(userIds: string[]): Promise<Excepciones> {
    if (userIds.length === 0) return { sinMarcar30Dias: [], sesionesAbiertas: [] };

    const tz = this.tzOf();
    const now = new Date();
    const cutoff = new Date(now.getTime() - DIAS_SIN_MARCAR * 24 * 60 * 60 * 1000);
    const capMs = this.maxOpenSessionHoursOf() * 60 * 60 * 1000;

    const nombres = await this.nombresPorUsuario(userIds);

    let rows: CheckInRow[];
    try {
      rows = (await this.ctx.prisma.checkInRecord.findMany({
        where: {
          userId: { in: userIds },
          OR: [{ checkOutAt: null }, { checkInAt: { gte: cutoff } }],
        },
        select: { userId: true, checkInAt: true, checkOutAt: true },
        orderBy: { checkInAt: 'asc' },
      })) as CheckInRow[];
    } catch (e) {
      this.ctx.logger.warn(`TeamService.excepciones: no se pudo leer CheckInRecord: ${e}`);
      return { sinMarcar30Dias: [], sesionesAbiertas: [] };
    }

    const marcoReciente = new Set<string>();
    // La sesión abierta más vieja por persona (normalmente hay una sola).
    const abiertaViejaDesde = new Map<string, Date>();

    for (const r of rows) {
      if (r.checkInAt >= cutoff) marcoReciente.add(r.userId);
      if (r.checkOutAt == null && now.getTime() - r.checkInAt.getTime() > capMs) {
        const actual = abiertaViejaDesde.get(r.userId);
        if (!actual || r.checkInAt < actual) abiertaViejaDesde.set(r.userId, r.checkInAt);
      }
    }

    const nombreDe = (userId: string): string => {
      const n = nombres.get(userId);
      return n ? `${n.firstName} ${n.lastName}` : userId;
    };

    const sinMarcar30Dias = userIds
      .filter(id => !marcoReciente.has(id))
      .map(userId => ({ userId, nombre: nombreDe(userId) }));

    const sesionesAbiertas = [...abiertaViejaDesde.entries()]
      .map(([userId, desde]) => ({ userId, nombre: nombreDe(userId), desde: localDateString(desde, tz) }));

    return { sinMarcar30Dias, sesionesAbiertas };
  }
}
