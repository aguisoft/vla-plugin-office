import type { PluginContext } from '@vla/plugin-sdk';
import {
  periodBounds, capOpenSession, aggregateSessions, clipSpan, type Period, type Span,
} from '../lib/timesheet';
import {
  estadoRegistro, diasConRegistro, diasFinDeSemana, diasHabiles, computeNorm, PERIODOS_NORMA,
  variacion, entradaHabitual, type EstadoRegistro, type Variacion,
} from '../lib/team-stats';
import { localDateString } from '../lib/local-date';
import { coverageMatrix, type Matriz } from '../lib/coverage';
import { nombresPorUsuario, type NombreInfo } from '../lib/user-names';
import type { OrgService } from './org.service';
import type { HolidayService } from './holiday.service';

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
  /**
   * Cuántos de los `diasConRegistro` cayeron fuera de lunes-viernes (I6).
   * `diasConRegistro` sigue siendo el total real -- no se esconde el trabajo
   * de fin de semana -- pero comparado tal cual contra `diasHabiles` produce
   * fracciones como "7/5", que en la lectura obvia parecen un error del
   * sistema. La interfaz resta este valor para armar el numerador que sí
   * comparte universo con el denominador, y lo muestra aparte.
   */
  diasFinDeSemana: number;
  entradaHabitual: string | null;
  /** YYYY-MM-DD local. `null` = de verdad nunca marcó. Ver `ultimoDisponible`. */
  ultimoRegistro: string | null;
  /**
   * `false` = la consulta del último registro no se pudo leer, y
   * `ultimoRegistro` en `null` acá NO significa "nunca marcó" sino "no se
   * pudo averiguar". Sin este campo los dos casos son indistinguibles desde
   * afuera y la interfaz no tiene forma de no decir «nunca» sobre alguien
   * que sí marcó.
   */
  ultimoDisponible: boolean;
}

export interface Excepciones {
  sinMarcar30Dias: Array<{ userId: string; nombre: string }>;
  sesionesAbiertas: Array<{ userId: string; nombre: string; desde: string }>;
}

type CheckInRow = { userId: string; checkInAt: Date; checkOutAt: Date | null };

/** Ventana para "no ha marcado en N días" en `excepciones`. */
const DIAS_SIN_MARCAR = 30;

export class TeamService {
  /**
   * `org` y `holidays` alimentan I5 (descontar feriados por país del
   * denominador de "N de M días"). Van al final y no antes de `ctx` para no
   * mover los parámetros que ya usan los llamadores existentes de más arriba
   * en la firma.
   */
  constructor(
    private readonly ctx: PluginContext,
    private readonly tzOf: () => string,
    private readonly maxOpenSessionHoursOf: () => number,
    private readonly org: OrgService,
    private readonly holidays: HolidayService,
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
   *
   * `ultimos` viaja aparte porque es OTRA consulta, independiente de la que
   * falló acá: si ella sí funcionó, no hay razón para apagar también el
   * «último visto» de cada persona.
   */
  private filaSinConsulta(
    userId: string,
    nombres: Map<string, NombreInfo>,
    diasHabilesPeriodo: number,
    ultimos: Map<string, string> | null,
  ): FilaEquipo {
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
      // Sin sesiones que leer, no hay fin de semana que separar del cero.
      diasFinDeSemana: 0,
      entradaHabitual: null,
      ultimoRegistro: ultimos?.get(userId) ?? null,
      ultimoDisponible: ultimos !== null,
    };
  }

  /**
   * Fila de respaldo cuando la consulta de NOMBRES falla (I1).
   *
   * `nombresPorUsuario` es una consulta distinta de la de sesiones, que puede
   * haber funcionado -- pero sin saber de quién es cada fila, los minutos no
   * significan nada: mostrarlos junto a un nombre en blanco es peor que no
   * mostrarlos. Por eso la fila entera se apaga a `no-disponible`, igual que
   * `filaSinConsulta`, en vez de mezclar un nombre vacío con tiempos reales.
   */
  private filaSinNombres(userId: string, diasHabilesPeriodo: number): FilaEquipo {
    return {
      userId,
      firstName: '',
      lastName: '',
      email: '',
      estado: 'no-disponible',
      totalMinutes: 0,
      openSessionCapped: false,
      variacion: { tipo: 'sin-base' },
      diasConRegistro: 0,
      diasHabiles: diasHabilesPeriodo,
      diasFinDeSemana: 0,
      entradaHabitual: null,
      ultimoRegistro: null,
      ultimoDisponible: false,
    };
  }

  /**
   * Feriados efectivos de cada persona, como fechas `YYYY-MM-DD`, dentro del
   * período actual (I5). Resuelve el país de cada quien con `OrgService.roster`
   * y le pide a `HolidayService` solo los feriados de los países que de verdad
   * aparecen en `userIds` -- una persona de Argentina nunca pierde un día por
   * un feriado tico.
   *
   * `null` si cualquiera de las dos consultas falla: el llamador entonces NO
   * descuenta nada de `diasHabiles` -- un denominador algo generoso es menos
   * dañino que apagar la pantalla entera -- pero queda logueado para que no
   * pase desapercibido según el país de las personas.
   */
  private async feriadosPorUsuario(
    userIds: string[], currentBounds: Span,
  ): Promise<Map<string, ReadonlySet<string>> | null> {
    try {
      const roster = await this.org.roster(userIds);
      const paises = new Set<string>();
      for (const r of roster.values()) paises.add(r.country);
      const porPais = await this.holidays.datesByCountry([...paises], currentBounds.start, currentBounds.end);
      const out = new Map<string, ReadonlySet<string>>();
      for (const userId of userIds) {
        const pais = roster.get(userId)?.country;
        out.set(userId, (pais && porPais.get(pais)) || new Set<string>());
      }
      return out;
    } catch (e) {
      this.ctx.logger.warn(`TeamService: no se pudieron leer los feriados por país, no se descuenta ninguno: ${e}`);
      return null;
    }
  }

  /**
   * Fecha del último check-in de cada persona, sin importar el período (C1).
   *
   * Consulta aparte y SIN cota inferior a propósito: si saliera de la misma
   * consulta que arma las filas (`checkInsDelEquipo`), su ventana sería la de
   * la norma -- 20 días hábiles, 8 semanas o 6 meses -- y quien no marcó
   * dentro de ella aparecería como «nunca», una acusación fabricada por un
   * WHERE y no por un hecho real. La columna «Último» responde «¿cuándo se le
   * vio por última vez?», sin importar el período que se esté mirando.
   *
   * Degrada a `null` si falla, y el llamador distingue ese caso ("no se pudo
   * averiguar") del "de verdad nunca marcó" (persona ausente del mapa) vía
   * `FilaEquipo.ultimoDisponible`.
   */
  private async ultimoRegistroPorUsuario(userIds: string[]): Promise<Map<string, string> | null> {
    try {
      const tz = this.tzOf();
      const rows = await this.ctx.prisma.checkInRecord.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds } },
        _max: { checkInAt: true },
      });
      const out = new Map<string, string>();
      for (const r of rows as Array<{ userId: string; _max: { checkInAt: Date | null } }>) {
        if (r._max.checkInAt) out.set(r.userId, localDateString(r._max.checkInAt, tz));
      }
      return out;
    } catch (e) {
      this.ctx.logger.warn(`TeamService: no se pudo leer el último registro por usuario: ${e}`);
      return null;
    }
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

    // I4: cuánto ha transcurrido del período EN CURSO, en milisegundos reales
    // -- no un período de calendario. Se usa más abajo para acotar cada
    // período PREVIO (ya cerrado) al mismo punto relativo, en vez de
    // compararlo completo contra un actual que todavía va a la mitad. Si el
    // período ya terminó, `efectivo.end` coincide con `currentBounds.end` y
    // esto cubre la duración entera.
    const transcurrido = efectivo.end.getTime() - currentBounds.start.getTime();

    const periodosPrevios = this.periodosAnteriores(anchor, period, tz, PERIODOS_NORMA[period]);
    const ventanaNorma: Span = {
      start: periodosPrevios[periodosPrevios.length - 1].start,
      end: periodosPrevios[0].end,
    };

    const [nombres, rows, ultimos, feriados] = await Promise.all([
      nombresPorUsuario(this.ctx, userIds),
      this.checkInsDelEquipo(userIds, ventanaNorma.start, currentBounds.end),
      this.ultimoRegistroPorUsuario(userIds),
      this.feriadosPorUsuario(userIds, currentBounds),
    ]);

    // I5: denominador de "N de M días" POR PERSONA -- el calendario COMPLETO
    // del período pedido, corrido o no (es la excepción a `efectivo`: si se
    // acotara a "ahora", un lunes diría "1 de 1" y un viernes "5 de 5", y la
    // fracción perdería el sentido de "cuánto falta/se cumplió"), menos los
    // feriados del país de esa persona en particular. `feriados` es `null`
    // si esa consulta falló -- ahí no se descuenta nada (ver `feriadosPorUsuario`).
    const diasHabilesDe = (userId: string) => diasHabiles(currentBounds, tz, feriados?.get(userId)).length;

    // I1: sin nombres no hay forma de decir de quién es cada minuto, así que
    // la fila entera se apaga -- ver `filaSinNombres`. Se revisa ANTES que la
    // consulta de sesiones porque, aunque esta última haya funcionado, mostrar
    // sus números junto a un nombre en blanco es el defecto que se corrige acá.
    if (nombres === null) {
      return {
        filas: userIds.map(userId => this.filaSinNombres(userId, diasHabilesDe(userId))),
        cobertura: sinCobertura,
      };
    }

    if (rows === null) {
      return {
        filas: userIds.map(userId => this.filaSinConsulta(userId, nombres, diasHabilesDe(userId), ultimos)),
        cobertura: sinCobertura,
      };
    }

    const byUser = new Map<string, Span[]>();
    const acotadas = new Set<string>();
    // userId -> (fecha local -> primera entrada de ese día), solo dentro de
    // la ventana de la norma. `entradaHabitual` recibe una entrada por día,
    // no todas las sesiones.
    const entradasPorDia = new Map<string, Map<string, Date>>();

    for (const r of rows) {
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
      // I4: cada período previo (YA CERRADO -- `p` es su propio Span, nunca
      // `efectivo`) se acota al MISMO punto relativo que ya transcurrió del
      // actual (`p.start + transcurrido`), no a su duración completa. Sin
      // esto, un lunes a las 10am comparaba unas pocas horas contra semanas
      // enteras y salía ~-90% para todo el mundo. `Math.min` contra
      // `p.end` es la guarda para cuando el período previo es más corto que
      // el actual (p. ej. febrero contra un marzo de 31 días): ahí
      // `transcurrido` ya cubre el período previo entero y no hay que
      // acotarlo más. Un período previo cerrado con el actual TAMBIÉN
      // cerrado da `transcurrido` = duración completa, y esto no cambia nada
      // (mismo caso que ya cubría la prueba de C2/C3).
      const totalesPrevios = periodosPrevios.map(p => {
        const finAcotado = new Date(Math.min(p.start.getTime() + transcurrido, p.end.getTime()));
        return aggregateSessions(sesiones, { start: p.start, end: finAcotado }, tz).totalMinutes;
      });
      const norma = computeNorm(totalesPrevios);
      const nombre = nombres.get(userId);
      const primerasEntradas = [...(entradasPorDia.get(userId)?.values() ?? [])];
      // I6: `diasConRegistro` sigue contando TODOS los días con sesión
      // (correcto, no se esconde el fin de semana) -- acá se separa cuántos
      // de esos caen fuera de lunes-viernes para que la interfaz arme un
      // numerador que sí comparte universo con `diasHabiles`.
      const diasRegistrados = diasConRegistro(sesiones, efectivo, tz);

      return {
        userId,
        firstName: nombre?.firstName ?? '',
        lastName: nombre?.lastName ?? '',
        email: nombre?.email ?? '',
        estado: estadoRegistro(sesiones, efectivo),
        totalMinutes: totalActual,
        openSessionCapped: acotadas.has(userId),
        variacion: variacion(totalActual, norma),
        diasConRegistro: diasRegistrados.length,
        diasHabiles: diasHabilesDe(userId),
        diasFinDeSemana: diasFinDeSemana(diasRegistrados),
        entradaHabitual: entradaHabitual(primerasEntradas, tz),
        // C1: de una consulta APARTE (`ultimoRegistroPorUsuario`), sin cota
        // inferior -- ver su comentario. `null` con `ultimoDisponible: true`
        // es "de verdad nunca marcó"; con `false` es "no se pudo averiguar".
        ultimoRegistro: ultimos?.get(userId) ?? null,
        ultimoDisponible: ultimos !== null,
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

    // I1: un `userId` crudo no es un nombre -- nadie que lea el aviso de
    // excepciones sabe a quién señala un UUID. Si la consulta de nombres
    // falló (`null`) o a esta persona en particular no le llegó nombre, se
    // dice «no disponible» en vez de imprimir el identificador interno.
    const nombreDe = (userId: string): string => {
      const n = nombres?.get(userId);
      return n ? `${n.firstName} ${n.lastName}` : 'no disponible';
    };

    const sinMarcar30Dias = userIds
      .filter(id => !marcoReciente.has(id))
      .map(userId => ({ userId, nombre: nombreDe(userId) }));

    const sesionesAbiertas = [...abiertaViejaDesde.entries()]
      .map(([userId, desde]) => ({ userId, nombre: nombreDe(userId), desde: localDateString(desde, tz) }));

    return { sinMarcar30Dias, sesionesAbiertas };
  }
}
