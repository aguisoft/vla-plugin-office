import type { PluginContext } from '@vla/plugin-sdk';
import {
  validateAbsenceInput, findOverlap,
  type AbsenceInput, type AbsenceWindow,
} from '../lib/absence-validation';
import type { ValidationError } from '../lib/status-rules';
import { localDayStart, localDayEnd } from '../lib/local-date';

/** VACACIONES e INCAPACIDAD son de día completo y se normalizan a
 *  00:00:00/23:59:59 hora local; PERMISO lleva hora real y no se toca. */
const FULL_DAY_TYPES = new Set(['VACACIONES', 'INCAPACIDAD']);

/**
 * Ancla a mediodía UTC de la fecha indicada por el string recibido del
 * cliente -- se usa SOLO la parte de fecha (`slice(0, 10)`), no la hora. El
 * frontend arma `startAt`/`endAt` con la zona del NAVEGADOR (ver
 * `DateRangeModal.tsx`), no la de la operación, así que la hora que manda no
 * es confiable; la fecha sí lo es para cualquier zona real (mediodía UTC
 * cae dentro del mismo día calendario en cualquier huso horario habitado).
 * `localDayStart`/`localDayEnd` recién después proyectan ESA fecha a los
 * límites de día en la zona de la operación (`tz`).
 */
function dateOnlyAnchor(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T12:00:00.000Z`);
}

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
    // 23:59:59 HORA LOCAL convertida a UTC, y la zona que cuenta es la de la
    // operación (`tz`, parámetro de este método), no la del navegador de
    // quien registra. Antes de este fix el único lugar que aplicaba esa
    // regla era `DateRangeModal.tsx` en el frontend, con la zona DEL
    // NAVEGADOR -- una laptop en UTC registrando "3 al 14 de noviembre"
    // mandaba límites que en Costa Rica empezaban la tarde del 2 y
    // terminaban la tarde del 14. Los helpers de `local-date.ts` existen
    // para esto desde hace varias tareas; hasta este fix no los llamaba
    // nadie en producción, solo su propio archivo de pruebas.
    const startAt = FULL_DAY_TYPES.has(input.type)
      ? localDayStart(dateOnlyAnchor(input.startAt), tz)
      : new Date(input.startAt);
    const endAt = FULL_DAY_TYPES.has(input.type)
      ? localDayEnd(dateOnlyAnchor(input.endAt), tz)
      : new Date(input.endAt);

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
