import type { PluginContext } from '@vla/plugin-sdk';
import {
  periodBounds, capOpenSession, aggregateSessions, clipSpan, type Period, type Span,
} from '../lib/timesheet';
import {
  estadoRegistro, diasConRegistro, diasHabiles, computeNorm, PERIODOS_NORMA, variacion,
  entradaHabitual, type EstadoRegistro, type Variacion,
} from '../lib/team-stats';
import { localDateString } from '../lib/local-date';
import { coverageMatrix, type Matriz } from '../lib/coverage';
import { nombresPorUsuario, type NombreInfo } from '../lib/user-names';

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

/** Ventana para "no ha marcado en N días" en `excepciones`. */
const DIAS_SIN_MARCAR = 30;

export class TeamService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly tzOf: () => string,
    private readonly maxOpenSessionHoursOf: () => number,
  ) {}

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
   * Delegado en `filasYCobertura`: existía sola antes de la matriz de
   * cobertura y sus pruebas ya la llaman con esta firma exacta, así que se
   * conserva como una vista parcial del mismo cálculo en vez de forzar a
   * cada consumidor a pedir la cobertura aunque no la use.
   */
  async filas(userIds: string[], period: Period, anchor: Date): Promise<FilaEquipo[]> {
    return (await this.filasYCobertura(userIds, period, anchor)).filas;
  }

  /**
   * Filas del equipo Y matriz de cobertura horaria, del MISMO query.
   *
   * Una sola consulta trae `CheckInRecord` de todo `userIds` desde el inicio
   * del período más antiguo de la norma hasta el fin del período actual, y el
   * reparto por persona y por período se hace en memoria: con 22 personas y
   * miles de filas históricas, una consulta por persona serían 22 viajes a la
   * base en vez de uno. La cobertura sale de las MISMAS sesiones ya armadas
   * para las filas -- `coverageMatrix` recorta contra `currentBounds`, así
   * que las sesiones de la ventana de la norma que no tocan el período actual
   * simplemente no aportan celdas, sin necesidad de otra consulta.
   */
  async filasYCobertura(
    userIds: string[], period: Period, anchor: Date,
  ): Promise<{ filas: FilaEquipo[]; cobertura: Matriz }> {
    const sinCobertura: Matriz = { horaMin: 0, horaMax: 0, fechas: [], celdas: [] };
    if (userIds.length === 0) return { filas: [], cobertura: sinCobertura };

    const tz = this.tzOf();
    const capHours = this.maxOpenSessionHoursOf();
    const currentBounds = periodBounds(anchor, period, tz);
    // Denominador de "N de M días": el calendario COMPLETO del período pedido,
    // corrido o no. Es la excepción a `efectivo` de abajo a propósito -- si se
    // acotara a "ahora", un lunes diría "1 de 1" y un viernes "5 de 5", y la
    // fracción perdería el sentido de "cuánto falta/se cumplió" que la
    // interfaz necesita.
    const diasHabilesPeriodo = diasHabiles(currentBounds, tz).length;

    // C2/C3: el fin efectivo nunca pasa del presente. Un período que incluye
    // hoy no puede contar horas que todavía no ocurrieron (`capOpenSession`,
    // `aggregateSessions`) ni dibujar días que no han pasado (`coverageMatrix`)
    // -- `/timesheet/office` ya lo hacía (index.ts:862) y esta vista no, así
    // que la tabla y el detalle daban números distintos sobre la misma
    // persona, y el mapa de cobertura pintaba el resto de la semana como
    // "nadie conectado". Un período ya cerrado no cambia: `efectivo.end`
    // coincide con `currentBounds.end`.
    const ahora = new Date();
    const efectivo: Span = {
      start: currentBounds.start,
      end: currentBounds.end < ahora ? currentBounds.end : ahora,
    };

    const periodosPrevios = this.periodosAnteriores(anchor, period, tz, PERIODOS_NORMA[period]);
    const ventanaNorma: Span = {
      start: periodosPrevios[periodosPrevios.length - 1].start,
      end: periodosPrevios[0].end,
    };

    const nombres = await nombresPorUsuario(this.ctx, userIds);
    const rows = await this.checkInsDelEquipo(userIds, ventanaNorma.start, currentBounds.end);

    if (rows === null) {
      return {
        filas: userIds.map(userId => this.filaSinConsulta(userId, nombres, diasHabilesPeriodo)),
        cobertura: sinCobertura,
      };
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
        end = capOpenSession(r.checkInAt, efectivo.end, capHours * 60);
        // Solo cuenta si el tramo YA ACOTADO toca el período efectivo (mismo
        // chequeo que TimesheetService.officeTime): una sesión abierta vieja
        // que la cota deja fuera del período no debería decir que lo acotó.
        if (end < efectivo.end && clipSpan({ start: r.checkInAt, end }, efectivo)) {
          acotadas.add(r.userId);
        }
      }

      const lista = byUser.get(r.userId) ?? [];
      lista.push({ start: r.checkInAt, end });
      byUser.set(r.userId, lista);
    }

    const filas = userIds.map(userId => {
      const sesiones = byUser.get(userId) ?? [];
      const totalActual = aggregateSessions(sesiones, efectivo, tz).totalMinutes;
      // La norma se calcula SOLO sobre los períodos anteriores, y esos son
      // períodos YA CERRADOS -- `p` es su propio Span, nunca `efectivo` --
      // así que no se acotan a "ahora": acotarlos les restaría horas que de
      // verdad ocurrieron. El actual tampoco entra acá, para no comparar la
      // norma contra sí misma.
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
        estado: estadoRegistro(sesiones, efectivo),
        totalMinutes: totalActual,
        openSessionCapped: acotadas.has(userId),
        variacion: variacion(totalActual, norma),
        diasConRegistro: diasConRegistro(sesiones, efectivo, tz).length,
        diasHabiles: diasHabilesPeriodo,
        entradaHabitual: entradaHabitual(primerasEntradas, tz),
        // Sin acotar al período: responde "¿cuándo se le vio por última vez?"
        // con el checkInAt crudo más reciente de la ventana consultada, no el
        // que sobrevive a clipSpan -- eso ya lo cubre diasConRegistro.
        ultimoRegistro: ultimo ? localDateString(ultimo, tz) : null,
      };
    });

    // Mismas sesiones que arriba -- ya con las abiertas acotadas contra
    // `efectivo.end` (líneas arriba, `capOpenSession`) -- así que
    // `coverageMatrix` no repite esa cota ni puede desacordarse de ella.
    // Se recorta contra `efectivo` y no contra `currentBounds`: por la misma
    // razón de C2/C3, un día que todavía no pasa no puede pintarse como
    // "nadie conectado" -- simplemente no debe aparecer.
    const porPersona = userIds.map(userId => ({ userId, sesiones: byUser.get(userId) ?? [] }));
    const cobertura = coverageMatrix(porPersona, efectivo, tz);

    return { filas, cobertura };
  }

  /**
   * Excepciones del equipo: quién no ha marcado en `DIAS_SIN_MARCAR` días y
   * quién tiene una sesión abierta más vieja que la cota configurada.
   *
   * No recibe período ni ancla -- a diferencia de `filas()`, mira el
   * historial reciente completo, no una ventana de norma -- así que arma su
   * propia consulta en vez de reusar la de `filas()`.
   *
   * Si la consulta de `CheckInRecord` falla, este método RECHAZA en vez de
   * degradar a `{ sinMarcar30Dias: [], sesionesAbiertas: [] }` (así se
   * comportaba hasta Task 9). Un arreglo vacío ahí es el mismo defecto que
   * este plugin lleva corrigiendo desde `FilaEquipo.estado`: un cero
   * inventado que dice «no hay excepciones» cuando en realidad la consulta
   * ni corrió. Cada llamador decide cómo degradar según lo que necesite --
   * `/timesheet/team` (Task 5/6) conserva el arreglo vacío para no cambiar
   * lo que ya se revisó, y `ComplianceService.cumplimiento` (Task 9) lo
   * refleja como `null` -- "no disponible", nunca `0` -- porque ahí un
   * conteo silencioso es justo lo que esta pantalla existe para impedir.
   */
  async excepciones(userIds: string[]): Promise<Excepciones> {
    if (userIds.length === 0) return { sinMarcar30Dias: [], sesionesAbiertas: [] };

    const tz = this.tzOf();
    const now = new Date();
    const cutoff = new Date(now.getTime() - DIAS_SIN_MARCAR * 24 * 60 * 60 * 1000);
    const capMs = this.maxOpenSessionHoursOf() * 60 * 60 * 1000;

    const nombres = await nombresPorUsuario(this.ctx, userIds);

    const rows = (await this.ctx.prisma.checkInRecord.findMany({
      where: {
        userId: { in: userIds },
        OR: [{ checkOutAt: null }, { checkInAt: { gte: cutoff } }],
      },
      select: { userId: true, checkInAt: true, checkOutAt: true },
      orderBy: { checkInAt: 'asc' },
    })) as CheckInRow[];

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
