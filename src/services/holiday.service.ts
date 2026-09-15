import type { PluginContext } from '@vla/plugin-sdk';
import {
  isHolidayEffective, movableHolidays, validateOverrideInput, holidayMatchesCountry, dateOnly,
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
    if (!holidayMatchesCountry(holiday as any as HolidayRow, country)) {
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
   * Usuarios que hoy están de feriado, con la justificación del override que
   * corresponda (o null si el feriado no fue movido, o si no aplica).
   *
   * Un solo par de queries para toda la oficina, no uno por persona — este
   * método reemplaza a un `overrideJustification(userId, ...)` que existió
   * antes y que el snapshot llamaba UNA VEZ POR USUARIO EN FERIADO dentro de
   * su ciclo. Un feriado nacional pone a toda la oficina en FERIADO a la
   * vez, así que ese patrón disparaba una consulta (o dos) por persona en
   * cada `GET /snapshot`, justo lo que este método existe para evitar. Ahora
   * `holidays` y `allOverrides` se cargan una sola vez y de ahí sale tanto
   * el booleano (el `Map` se puede usar con `.has()`, igual que el `Set` de
   * antes) como la justificación (`.get()`).
   *
   * El filtro de país se mantiene en la rama de la justificación, igual que
   * en `isHolidayEffective`: un override viejo que quedó apuntando a un
   * feriado de un país que el colaborador ya no tiene no concede nada
   * (Task 8, Ruling 10; el mismo agujero que `overrideJustification` cerraba
   * antes con `holidayMatchesCountry`).
   */
  async effectiveByUserId(
    now: Date,
    countryOf: Map<string, string>,
    tz: string,
  ): Promise<Map<string, string | null>> {
    const [holidays, allOverrides] = await Promise.all([
      this.ctx.prisma.holiday.findMany(),
      this.ctx.prisma.holidayOverride.findMany(),
    ]);

    const holidayById = new Map((holidays as any[]).map(h => [h.id, h]));
    const overridesByUser = new Map<string, any[]>();
    for (const o of allOverrides as any[]) {
      const list = overridesByUser.get(o.userId) ?? [];
      list.push(o);
      overridesByUser.set(o.userId, list);
    }

    const today = localDateString(now, tz);
    const result = new Map<string, string | null>();

    for (const [userId, country] of countryOf) {
      const userOverrides = overridesByUser.get(userId) ?? [];
      const on = isHolidayEffective({
        now,
        country,
        holidays: holidays as any as HolidayRow[],
        overrides: userOverrides.map(o => ({ holidayId: o.holidayId, newDate: o.newDate })) as OverrideRow[],
        tz,
      });
      if (!on) continue;

      // ¿Cuál override, si alguno, es el que puso hoy como feriado? Solo esa
      // rama tiene justificación — un feriado fijo sin mover nunca la tiene.
      let justification: string | null = null;
      for (const o of userOverrides) {
        if (dateOnly(o.newDate) !== today) continue;
        const h = holidayById.get(o.holidayId);
        if (h && holidayMatchesCountry(h as any as HolidayRow, country)) {
          justification = o.justification ?? null;
          break;
        }
      }
      result.set(userId, justification);
    }
    return result;
  }
}
