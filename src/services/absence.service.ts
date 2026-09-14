import type { PluginContext } from '@vla/plugin-sdk';
import {
  validateAbsenceInput, findOverlap,
  type AbsenceInput, type AbsenceWindow,
} from '../lib/absence-validation';
import type { ValidationError } from '../lib/status-rules';

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; errors: ValidationError[] }
  | { ok: false; conflict: AbsenceWindow };

export class AbsenceService {
  constructor(private readonly ctx: PluginContext) {}

  async create(
    userId: string,
    input: AbsenceInput,
    createdBy: string,
    tz: string,
  ): Promise<CreateResult> {
    const errors = validateAbsenceInput(input, tz);
    if (errors.length) return { ok: false, errors };

    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);

    const existing = await this.listForUser(userId);
    const clash = findOverlap({ startAt, endAt }, existing);
    if (clash) return { ok: false, conflict: clash };

    const row = await this.ctx.prisma.absenceRecord.create({
      data: {
        userId,
        type: input.type as any,
        startAt,
        endAt,
        justification: input.justification?.trim() || null,
        createdBy,
      },
    });

    await this.ctx.hooks.doAction('office.absence.created', {
      userId, type: input.type, startAt, endAt,
    });

    return { ok: true, id: (row as any).id };
  }

  async listForUser(userId: string, from?: Date, to?: Date): Promise<AbsenceWindow[]> {
    const where: any = { userId };
    if (from && to) {
      // Cualquier ausencia que toque la ventana pedida.
      where.startAt = { lte: to };
      where.endAt = { gte: from };
    }
    const rows = await this.ctx.prisma.absenceRecord.findMany({
      where,
      orderBy: { startAt: 'asc' },
    });
    return (rows as any[]).map(toWindow);
  }

  /**
   * Ausencia activa de cada usuario en un solo query.
   * El snapshot y el blindaje del cron lo usan para no pegarle a la base una
   * vez por usuario.
   */
  async activeByUserId(now: Date): Promise<Map<string, AbsenceWindow>> {
    const rows = await this.ctx.prisma.absenceRecord.findMany({
      where: { startAt: { lte: now }, endAt: { gte: now } },
      orderBy: { startAt: 'asc' },
    });
    const map = new Map<string, AbsenceWindow>();
    for (const r of rows as any[]) {
      if (!map.has(r.userId)) map.set(r.userId, toWindow(r));
    }
    return map;
  }

  async remove(id: string, requesterId: string, canManage: boolean): Promise<boolean> {
    const row = await this.ctx.prisma.absenceRecord.findUnique({ where: { id } });
    if (!row) return false;
    if (!canManage && (row as any).userId !== requesterId) return false;
    await this.ctx.prisma.absenceRecord.delete({ where: { id } });
    return true;
  }
}

function toWindow(r: any): AbsenceWindow {
  return {
    type: r.type,
    startAt: r.startAt,
    endAt: r.endAt,
    justification: r.justification ?? null,
  };
}
