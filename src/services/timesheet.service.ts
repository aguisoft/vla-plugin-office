import type { PluginContext } from '@vla/plugin-sdk';
import type { AbsenceService } from './absence.service';
import { aggregateSessions, type OfficeAggregate, type Span } from '../lib/timesheet';

export interface OfficeTime extends OfficeAggregate {
  userId: string;
}

export class TimesheetService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly tzOf: () => string,
    // Consumido por cálculo de ausencias en tarea posterior
    private readonly absencesSvc: AbsenceService, // eslint-disable-line @typescript-eslint/no-unused-vars
    // Consumido por normalización de horas en tarea posterior
    private readonly workdayHoursOf: () => number, // eslint-disable-line @typescript-eslint/no-unused-vars
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
}
