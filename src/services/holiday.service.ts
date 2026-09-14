import type { PluginContext } from '@vla/plugin-sdk';
import {
  isHolidayEffective, movableHolidays, validateOverrideInput,
  type HolidayRow, type OverrideRow,
} from '../lib/holiday-resolver';
import { localDateString } from '../lib/local-date';
import type { ValidationError } from '../lib/status-rules';

export class HolidayService {
  constructor(private readonly ctx: PluginContext) {}

  async list(year?: number, country?: string): Promise<HolidayRow[]> {
    const where: any = {};
    if (country) where.country = country;
    if (year) {
      where.date = {
        gte: new Date(Date.UTC(year, 0, 1)),
        lt: new Date(Date.UTC(year + 1, 0, 1)),
      };
    }
    const rows = await this.ctx.prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
    return rows as any as HolidayRow[];
  }

  async create(date: Date, name: string, country: string): Promise<string> {
    const row = await this.ctx.prisma.holiday.create({ data: { date, name, country } });
    return (row as any).id;
  }

  async remove(id: string): Promise<boolean> {
    const row = await this.ctx.prisma.holiday.findUnique({ where: { id } });
    if (!row) return false;
    await this.ctx.prisma.holiday.delete({ where: { id } });
    return true;
  }

  async movableForUser(userId: string, country: string): Promise<HolidayRow[]> {
    const [holidays, overrides] = await Promise.all([
      this.list(undefined, country),
      this.overridesForUser(userId),
    ]);
    return movableHolidays(holidays, overrides, country);
  }

  async overridesForUser(userId: string): Promise<OverrideRow[]> {
    const rows = await this.ctx.prisma.holidayOverride.findMany({ where: { userId } });
    return (rows as any[]).map(r => ({ holidayId: r.holidayId, newDate: r.newDate }));
  }

  /**
   * `country` es el país RESUELTO HOY del colaborador (org.countryOf), no un
   * dato que el cliente pueda mandar. Es la defensa en la escritura que exige
   * la tarea: sin ella, un override viejo apuntaría a un feriado de un país
   * que el colaborador ya no tiene, y ese es exactamente el escenario que
   * isHolidayEffective ya bloquea del lado de la lectura (Task 8, Ruling 10).
   * Las dos hacen falta porque el país puede cambiar DESPUÉS de creado el
   * override: esta defensa evita que se cree uno nuevo mal dirigido; la de
   * lectura cubre los que ya existían cuando RRHH corrigió el país.
   */
  async setOverride(
    userId: string, holidayId: string, newDate: Date, justification: string, country: string, tz: string,
  ): Promise<{ ok: true } | { ok: false; errors: ValidationError[] }> {
    const holiday = await this.ctx.prisma.holiday.findUnique({ where: { id: holidayId } });
    if (!holiday) {
      return { ok: false, errors: [{ field: 'holidayId', message: 'Feriado no encontrado' }] };
    }
    if ((holiday as any).country !== country) {
      return { ok: false, errors: [{ field: 'holidayId', message: 'El feriado no corresponde a tu país' }] };
    }

    const errors = validateOverrideInput((holiday as any).date, newDate, justification, tz);
    if (errors.length) return { ok: false, errors };

    await this.ctx.prisma.holidayOverride.upsert({
      where: { userId_holidayId: { userId, holidayId } },
      create: { userId, holidayId, newDate, justification: justification.trim() },
      update: { newDate, justification: justification.trim() },
    });
    return { ok: true };
  }

  async clearOverride(userId: string, holidayId: string): Promise<boolean> {
    const row = await this.ctx.prisma.holidayOverride.findUnique({
      where: { userId_holidayId: { userId, holidayId } },
    });
    if (!row) return false;
    await this.ctx.prisma.holidayOverride.delete({
      where: { userId_holidayId: { userId, holidayId } },
    });
    return true;
  }

  /**
   * Usuarios que hoy están de feriado. Un solo par de queries para toda la
   * oficina, no uno por persona.
   */
  async effectiveByUserId(
    now: Date,
    countryOf: Map<string, string>,
    tz: string,
  ): Promise<Set<string>> {
    const [holidays, allOverrides] = await Promise.all([
      this.ctx.prisma.holiday.findMany(),
      this.ctx.prisma.holidayOverride.findMany(),
    ]);

    const byUser = new Map<string, OverrideRow[]>();
    for (const o of allOverrides as any[]) {
      const list = byUser.get(o.userId) ?? [];
      list.push({ holidayId: o.holidayId, newDate: o.newDate });
      byUser.set(o.userId, list);
    }

    const result = new Set<string>();
    for (const [userId, country] of countryOf) {
      const on = isHolidayEffective({
        now,
        country,
        holidays: holidays as any as HolidayRow[],
        overrides: byUser.get(userId) ?? [],
        tz,
      });
      if (on) result.add(userId);
    }
    return result;
  }

  /** Justificación del override que cae hoy, para mostrarla en la tarjeta. */
  async overrideJustification(userId: string, now: Date, tz: string): Promise<string | null> {
    const today = localDateString(now, tz);
    const rows = await this.ctx.prisma.holidayOverride.findMany({ where: { userId } });
    for (const r of rows as any[]) {
      if (r.newDate.toISOString().slice(0, 10) === today) return r.justification;
    }
    return null;
  }
}
