import type { PluginContext } from '@vla/plugin-sdk';
import type { AbsenceService } from './absence.service';
import {
  aggregateSessions, type OfficeAggregate, type Span, aggregateIntervals, type StatusSlice,
  tallyAbsences, type AbsenceTally,
} from '../lib/timesheet';
import { localDateString } from '../lib/local-date';

export interface OfficeTime extends OfficeAggregate {
  userId: string;
}

export class TimesheetService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly tzOf: () => string,
    private readonly absencesSvc: AbsenceService,
    private readonly workdayHoursOf: () => number,
  ) {}

  /**
   * Tiempo en oficina por persona dentro del período.
   *
   * Una consulta para todo el grupo, no una por persona. `checkOutAt IS NULL`
   * es la sesión abierta: se cierra contra el fin del período (que el llamador
   * ya acotó a `now` cuando el período incluye el presente), para que consultar
   * una semana vieja no muestre una sesión corriendo hasta hoy.
   */
  async officeTime(userIds: string[], span: Span): Promise<Map<string, OfficeTime>> {
    const result = new Map<string, OfficeTime>();
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
    for (const r of rows as any[]) {
      const end: Date = r.checkOutAt ?? span.end;
      const list = byUser.get(r.userId) ?? [];
      list.push({ start: r.checkInAt, end });
      byUser.set(r.userId, list);
    }

    const tz = this.tzOf();
    for (const userId of userIds) {
      const agg = aggregateSessions(byUser.get(userId) ?? [], span, tz);
      result.set(userId, { userId, ...agg });
    }
    return result;
  }

  /**
   * Intervalos del período. El intervalo abierto se cierra contra el fin del
   * span, que el llamador ya acotó a `now` cuando el período incluye el presente.
   */
  async statusBreakdown(userId: string, span: Span): Promise<StatusSlice[]> {
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
   */
  async coverageStart(): Promise<string | null> {
    const rows = await this.ctx.query<{ min: string | null }>(
      'SELECT MIN(started_at)::text AS min FROM office_status_intervals',
    );
    const min = rows[0]?.min;
    return min ? localDateString(new Date(min), this.tzOf()) : null;
  }
}
