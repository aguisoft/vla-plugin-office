import type { PluginContext } from '@vla/plugin-sdk';
import type { AbsenceService } from './absence.service';
import {
  aggregateSessions, type OfficeAggregate, type Span, aggregateIntervals, type StatusSlice,
  tallyAbsences, type AbsenceTally, capOpenSession, clipSpan,
} from '../lib/timesheet';
import { localDateString } from '../lib/local-date';

export interface OfficeTime extends OfficeAggregate {
  userId: string;
  /** `true` si alguna sesión sin marcar salida se acotó. Acotar en silencio cambia el número sin que nadie sepa por qué. */
  openSessionCapped: boolean;
  /** Horas a las que se acota una sesión abierta. Viaja con el flag para que la pantalla pueda decir a cuánto se acotó. */
  openSessionCapHours: number;
}

export class TimesheetService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly tzOf: () => string,
    private readonly absencesSvc: AbsenceService,
    private readonly workdayHoursOf: () => number,
    private readonly maxOpenSessionHoursOf: () => number,
  ) {}

  /**
   * Tiempo en oficina por persona dentro del período.
   *
   * Una consulta para todo el grupo, no una por persona. `checkOutAt IS NULL`
   * es la sesión abierta: se cierra contra el fin del período (que el llamador
   * ya acotó a `now` cuando el período incluye el presente), para que consultar
   * una semana vieja no muestre una sesión corriendo hasta hoy, y además se
   * acota a `MAX_OPEN_SESSION_HOURS` — ver `capOpenSession`: a quien entra de
   * vacaciones con la sesión abierta nadie se la cierra, y sin cota una semana
   * de ausencia reporta 10.080 minutos «en oficina».
   */
  async officeTime(userIds: string[], span: Span): Promise<Map<string, OfficeTime>> {
    const result = new Map<string, OfficeTime>();
    const capHours = this.maxOpenSessionHoursOf();
    if (userIds.length === 0) return result;

    const rows = await this.ctx.prisma.checkInRecord.findMany({
      where: {
        userId: { in: userIds },
        checkInAt: { lte: span.end },
        OR: [{ checkOutAt: null }, { checkOutAt: { gte: span.start } }],
      },
      select: { userId: true, checkInAt: true, checkOutAt: true },
      orderBy: { checkInAt: 'asc' },
    });

    const byUser = new Map<string, Span[]>();
    // Cuántas sesiones abiertas quedaron acotadas, por persona: la cota cambia
    // el total y la pantalla tiene que poder decirlo.
    const acotadas = new Map<string, number>();
    for (const r of rows as any[]) {
      let end: Date;
      if (r.checkOutAt) {
        end = r.checkOutAt;
      } else {
        end = capOpenSession(r.checkInAt, span.end, capHours * 60);
        // Se cuenta solo si el tramo YA ACOTADO toca el período consultado. La
        // consulta no acota por abajo el `checkInAt` de las filas abiertas —no
        // puede: una sesión que empezó antes del período puede seguir dentro—,
        // así que la de Ana, que entró el viernes 18 a las 08:00 y nunca salió,
        // también sale en la consulta del lunes 21. Ahí la cota cae el viernes a
        // las 20:00, `clipSpan` descarta el tramo y el total da 0; sin este
        // chequeo la pantalla mostraba «Una sesión quedó abierta sin marcar
        // salida; se acotó a 12 horas» pegado a «Sin tiempo registrado en este
        // período». El total no cambia: lo que se va es la nota donde no acotó
        // nada del período que se está mirando.
        if (end < span.end && clipSpan({ start: r.checkInAt, end }, span)) {
          acotadas.set(r.userId, (acotadas.get(r.userId) ?? 0) + 1);
        }
      }
      const list = byUser.get(r.userId) ?? [];
      list.push({ start: r.checkInAt, end });
      byUser.set(r.userId, list);
    }

    const tz = this.tzOf();
    for (const userId of userIds) {
      const agg = aggregateSessions(byUser.get(userId) ?? [], span, tz);
      result.set(userId, {
        userId,
        ...agg,
        openSessionCapped: (acotadas.get(userId) ?? 0) > 0,
        openSessionCapHours: capHours,
      });
    }
    return result;
  }

  /**
   * Intervalos del período. El intervalo abierto se cierra contra el fin del
   * span, que el llamador ya acotó a `now` cuando el período incluye el presente.
   *
   * Devuelve `null` cuando la consulta falla —tabla ausente, migración sin
   * aplicar, base caída—. `null` no es `[]`: `[]` significa «no hay intervalos»
   * y el llamador lo reconcilia mandando todo a «sin registrar»; `null`
   * significa «no se pudo leer» y no se puede reconciliar nada contra eso.
   *
   * El try/catch no es defensivo por gusto: Express 4 no atrapa rechazos de
   * promesas en handlers async, así que un 42P01 acá no da 500, mata el
   * proceso entero del API — el mismo modo de falla que ya obligó al try/catch
   * de runTimemanSync (ver index.ts).
   */
  async statusBreakdown(userId: string, span: Span): Promise<StatusSlice[] | null> {
    try {
      const rows = await this.ctx.query<{ status: string; started_at: string; ended_at: string | null }>(
        `SELECT status, started_at, ended_at
           FROM office_status_intervals
          WHERE user_id = $1
            AND started_at <= $3
            AND (ended_at IS NULL OR ended_at >= $2)
          ORDER BY started_at`,
        [userId, span.start.toISOString(), span.end.toISOString()],
      );

      const intervals = rows.map(r => ({
        status: r.status,
        start: new Date(r.started_at),
        end: r.ended_at ? new Date(r.ended_at) : span.end,
      }));

      return aggregateIntervals(intervals, span, this.tzOf());
    } catch (e) {
      this.ctx.logger.warn(`statusBreakdown: no se pudo leer office_status_intervals: ${e}`);
      return null;
    }
  }

  /**
   * Ausencias del período, agrupadas por tipo, en días y minutos equivalentes.
   *
   * Las ausencias no viven en `PresenceStatus` -- el snapshot las calcula al
   * vuelo -- así que `statusBreakdown` nunca las va a ver: hace falta pedirlas
   * aparte a `AbsenceService` y agregarlas con `tallyAbsences`.
   */
  async absences(userId: string, span: Span): Promise<AbsenceTally[]> {
    const rows = await this.absencesSvc.listForUserDetailed(userId, span.start, span.end);
    return tallyAbsences(
      rows.map(r => ({ type: r.type, startAt: r.startAt, endAt: r.endAt })),
      span,
      this.workdayHoursOf(),
      this.tzOf(),
    );
  }

  /**
   * Fecha desde la que hay registro, en `YYYY-MM-DD` local, o `null` si la tabla
   * está vacía. Sale de la tabla y no de una constante para que siga siendo cierta
   * aunque se recree o se purgue.
   *
   * Un fallo de la consulta también da `null` —el aviso de cobertura
   * simplemente no se dibuja— en vez de tumbar el proceso: mismo motivo que en
   * `statusBreakdown`.
   */
  async coverageStart(): Promise<string | null> {
    try {
      const rows = await this.ctx.query<{ min: string | null }>(
        'SELECT MIN(started_at)::text AS min FROM office_status_intervals',
      );
      const min = rows[0]?.min;
      return min ? localDateString(new Date(min), this.tzOf()) : null;
    } catch (e) {
      this.ctx.logger.warn(`coverageStart: no se pudo leer office_status_intervals: ${e}`);
      return null;
    }
  }
}
