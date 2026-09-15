import type { PluginContext } from '@vla/plugin-sdk';
import {
  validateAbsenceInput, findOverlap,
  type AbsenceInput, type AbsenceWindow,
} from '../lib/absence-validation';
import type { ValidationError } from '../lib/status-rules';
import { absenceBounds } from '../lib/absence-bounds';

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; errors: ValidationError[] }
  | { ok: false; conflict: AbsenceWindow };

/**
 * AbsenceWindow + identidad. El uso interno (solape, resolver de estado,
 * blindaje del cron) no necesita id/userId; la respuesta HTTP de GET
 * /absences sí, porque el frontend (Absence en frontend/src/types.ts) los
 * necesita para poder borrar lo que lista.
 */
export interface AbsenceRecord extends AbsenceWindow {
  id: string;
  userId: string;
}

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

    // El spec exige que VACACIONES/INCAPACIDAD se guarden como 00:00:00 y
    // 23:59:59.999 HORA LOCAL convertida a UTC, y la zona que cuenta es la
    // de la operación (`tz`, parámetro de este método), no la de quien
    // registra. El cálculo vive en `absence-bounds.ts` (función pura,
    // probada sin mocks de Prisma) porque ahí se documenta también el
    // contrato: estos dos tipos reciben FECHA PURA de `input.startAt`/
    // `endAt` ("YYYY-MM-DD"), no un instante -- PERMISO sigue mandando hora
    // real, sin normalizar. Ver el comentario de `absenceBounds` para la
    // regresión concreta que este contrato existe para evitar.
    const { startAt, endAt } = absenceBounds(input.type, input.startAt, input.endAt, tz);

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
   * Igual que listForUser, pero para la respuesta HTTP de GET /absences:
   * incluye id y userId (que el frontend necesita para poder borrar).
   */
  async listForUserDetailed(userId: string, from?: Date, to?: Date): Promise<AbsenceRecord[]> {
    const where: any = { userId };
    if (from && to) {
      where.startAt = { lte: to };
      where.endAt = { gte: from };
    }
    const rows = await this.ctx.prisma.absenceRecord.findMany({
      where,
      orderBy: { startAt: 'asc' },
    });
    return (rows as any[]).map(toRecord);
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

function toRecord(r: any): AbsenceRecord {
  return { id: r.id, userId: r.userId, ...toWindow(r) };
}
