import type { PluginContext } from '@vla/plugin-sdk';
import {
  isHolidayEffective, movableHolidays, validateOverrideInput, holidayMatchesCountry, dateOnly,
  effectiveHolidayDates, puedeDecidir, validateDecision, inicioDeMes, finDeMes,
  type HolidayRow, type OverrideRow, type OverrideStatus, type DecisionReason,
} from '../lib/holiday-resolver';
import { localDateString } from '../lib/local-date';
import type { ValidationError } from '../lib/status-rules';

/** Fila cruda de `office_holiday_overrides` (columnas en snake_case). */
interface OverrideDbRow {
  id: string;
  user_id: string;
  holiday_id: string;
  new_date: Date;
  justification: string;
  status: OverrideStatus;
  decided_by: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  created_at?: Date;
}

/** Lo que la pantalla necesita para explicar una solicitud. */
export interface SolicitudDetalle {
  id: string;
  userId: string;
  holidayId: string;
  holidayName: string | null;
  holidayDate: string | null;
  newDate: string;
  justification: string;
  status: OverrideStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** Aprobada porque no hay jefe que la revise, no porque alguien dijera que sí. */
  sinRevisor: boolean;
}

function toOverrideRow(r: OverrideDbRow): OverrideRow {
  return { holidayId: r.holiday_id, newDate: r.new_date, status: r.status };
}

function toDetalle(r: OverrideDbRow & { holiday_name?: string | null; holiday_date?: Date | null }): SolicitudDetalle {
  return {
    id: r.id,
    userId: r.user_id,
    holidayId: r.holiday_id,
    holidayName: r.holiday_name ?? null,
    holidayDate: r.holiday_date ? dateOnly(r.holiday_date) : null,
    newDate: dateOnly(r.new_date),
    justification: r.justification,
    status: r.status,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at ? r.decided_at.toISOString() : null,
    decisionNote: r.decision_note,
    sinRevisor: r.status === 'APPROVED' && r.decided_by === null,
  };
}

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

  /**
   * Fechas (`YYYY-MM-DD`) en que CADA persona tiene feriado, ya corridas por
   * sus overrides aprobados. Alimenta `diasHabiles(within, tz, feriados)`.
   *
   * Sustituye a un `datesByCountry` que agrupaba por país y devolvía siempre
   * el feriado NACIONAL. Era correcto para el conteo y equivocado para el día:
   * quien corría su feriado del martes al viernes figuraba trabajando el
   * martes (fuera de días hábiles) y ausente el viernes. El tablero castigaba
   * a quien movió su feriado para no frenar la producción, que es justo la
   * conducta que la regla quiere permitir.
   *
   * El rango se ensancha a MESES COMPLETOS antes de consultar. Un override
   * solo puede mover un feriado dentro de su mismo mes, pero el período
   * consultado puede partir el mes: pidiendo del 16 al 30 de septiembre, el
   * feriado del 15 queda fuera del rango aunque su fecha movida —el 18— caiga
   * dentro. Sin ensanchar, ese feriado desaparecía del denominador. Pedir
   * fechas de más es inocuo: `diasHabiles` solo consulta el set en los días
   * que recorre.
   */
  async effectiveDatesByUser(
    countryOf: Map<string, string>, from: Date, to: Date,
  ): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    if (countryOf.size === 0) return out;

    const countries = [...new Set(countryOf.values())];
    const userIds = [...countryOf.keys()];
    const desde = inicioDeMes(from);
    const hasta = finDeMes(to);

    const [holidays, overrides] = await Promise.all([
      this.ctx.prisma.holiday.findMany({
        where: { country: { in: countries }, date: { gte: desde, lte: hasta } },
        select: { id: true, date: true, country: true, name: true },
      }),
      this.ctx.query<OverrideDbRow>(
        `SELECT id, user_id, holiday_id, new_date, justification, status,
                decided_by, decided_at, decision_note
           FROM office_holiday_overrides
          WHERE status = 'APPROVED' AND user_id = ANY($1)`,
        [userIds],
      ),
    ]);

    const porUsuario = new Map<string, OverrideRow[]>();
    for (const o of overrides) {
      const list = porUsuario.get(o.user_id) ?? [];
      list.push(toOverrideRow(o));
      porUsuario.set(o.user_id, list);
    }

    for (const [userId, country] of countryOf) {
      out.set(userId, effectiveHolidayDates(
        holidays as any as HolidayRow[], porUsuario.get(userId) ?? [], country,
      ));
    }
    return out;
  }

  async movableForUser(userId: string, country: string): Promise<HolidayRow[]> {
    const [holidays, overrides] = await Promise.all([
      this.list(undefined, country),
      this.overridesForUser(userId),
    ]);
    return movableHolidays(holidays, overrides, country);
  }

  async overridesForUser(userId: string): Promise<OverrideRow[]> {
    const rows = await this.ctx.query<OverrideDbRow>(
      `SELECT id, user_id, holiday_id, new_date, justification, status,
              decided_by, decided_at, decision_note
         FROM office_holiday_overrides WHERE user_id = $1`,
      [userId],
    );
    return rows.map(toOverrideRow);
  }

  /**
   * Las solicitudes de esta persona con todo su estado, para que la pantalla
   * pueda decir "pendiente desde el martes" o "rechazada porque...".
   * `overridesForUser` devuelve solo lo que el resolver necesita.
   */
  async solicitudesDe(userId: string): Promise<SolicitudDetalle[]> {
    const rows = await this.ctx.query<OverrideDbRow & { holiday_name: string | null; holiday_date: Date | null }>(
      `SELECT o.id, o.user_id, o.holiday_id, o.new_date, o.justification, o.status,
              o.decided_by, o.decided_at, o.decision_note, o.created_at,
              h.name AS holiday_name, h.date AS holiday_date
         FROM office_holiday_overrides o
         LEFT JOIN virtual_office."Holiday" h ON h.id = o.holiday_id
        WHERE o.user_id = $1
        ORDER BY o.created_at DESC`,
      [userId],
    );
    return rows.map(toDetalle);
  }

  /**
   * La bandeja del jefe: las solicitudes PENDIENTES de su gente.
   *
   * Recibe los subordinados ya resueltos (`OrgService.managedUserIds`) en vez
   * de resolverlos acá: el servicio de feriados no sabe de organigrama, y
   * mezclarlo obligaría a inyectarle OrgService y crearía un ciclo entre los
   * dos servicios.
   */
  async pendientesDe(subordinadoIds: string[]): Promise<SolicitudDetalle[]> {
    if (subordinadoIds.length === 0) return [];
    const rows = await this.ctx.query<OverrideDbRow & { holiday_name: string | null; holiday_date: Date | null }>(
      `SELECT o.id, o.user_id, o.holiday_id, o.new_date, o.justification, o.status,
              o.decided_by, o.decided_at, o.decision_note, o.created_at,
              h.name AS holiday_name, h.date AS holiday_date
         FROM office_holiday_overrides o
         LEFT JOIN virtual_office."Holiday" h ON h.id = o.holiday_id
        WHERE o.status = 'PENDING' AND o.user_id = ANY($1)
        ORDER BY o.created_at ASC`,
      [subordinadoIds],
    );
    return rows.map(toDetalle);
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
    tieneJefe: boolean,
  ): Promise<{ ok: true; status: OverrideStatus } | { ok: false; errors: ValidationError[] }> {
    const holiday = await this.ctx.prisma.holiday.findUnique({ where: { id: holidayId } });
    if (!holiday) {
      return { ok: false, errors: [{ field: 'holidayId', message: 'Feriado no encontrado' }] };
    }
    if (!holidayMatchesCountry(holiday as any as HolidayRow, country)) {
      return { ok: false, errors: [{ field: 'holidayId', message: 'El feriado no corresponde a tu país' }] };
    }

    const errors = validateOverrideInput((holiday as any).date, newDate, justification, tz);
    if (errors.length) return { ok: false, errors };

    // Sin jefe directo no hay quién apruebe. Se registra ya aprobada, pero con
    // `decided_by` NULL: la fila dice que NADIE la revisó, en vez de mentir
    // poniendo al propio solicitante como aprobador. `decided_at` sí se llena,
    // y es lo que distingue "aprobada sin revisor" de "todavía pendiente".
    const status = tieneJefe ? 'PENDING' : 'APPROVED';
    const decidedAt = tieneJefe ? null : new Date();

    await this.ctx.query(
      `INSERT INTO office_holiday_overrides
         (user_id, holiday_id, new_date, justification, status, decided_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, holiday_id) DO UPDATE SET
         new_date      = EXCLUDED.new_date,
         justification = EXCLUDED.justification,
         status        = EXCLUDED.status,
         decided_at    = EXCLUDED.decided_at,
         decided_by    = NULL,
         decision_note = NULL,
         created_at    = now()`,
      [userId, holidayId, newDate, justification.trim(), status, decidedAt],
    );
    return { ok: true, status: status as OverrideStatus };
  }

  async clearOverride(userId: string, holidayId: string): Promise<boolean> {
    const rows = await this.ctx.query<{ id: string }>(
      'DELETE FROM office_holiday_overrides WHERE user_id = $1 AND holiday_id = $2 RETURNING id',
      [userId, holidayId],
    );
    return rows.length > 0;
  }

  /**
   * El jefe responde. `esJefeDirecto` llega resuelto del endpoint porque el
   * organigrama no vive acá (ver `pendientesDe`).
   */
  async decidir(
    solicitudId: string,
    viewerId: string,
    accion: 'approve' | 'reject',
    nota: string,
    esJefeDirecto: (solicitanteId: string) => Promise<boolean>,
  ): Promise<{ ok: true } | { ok: false; reason: DecisionReason } | { ok: false; errors: ValidationError[] }> {
    const [row] = await this.ctx.query<{ user_id: string; status: OverrideStatus }>(
      'SELECT user_id, status FROM office_holiday_overrides WHERE id = $1',
      [solicitudId],
    );

    const solicitud = row ? { userId: row.user_id, status: row.status } : null;
    // El chequeo de jefatura cuesta una consulta al organigrama: se hace solo
    // si hay solicitud y no es del propio viewer, que es lo que puedeDecidir
    // descarta primero de todas formas.
    const esJefe = solicitud && solicitud.userId !== viewerId
      ? await esJefeDirecto(solicitud.userId)
      : false;

    const permitido = puedeDecidir(solicitud, viewerId, esJefe);
    if (!permitido.ok) return permitido;

    const errors = validateDecision(accion, nota);
    if (errors.length) return { ok: false, errors };

    await this.ctx.query(
      `UPDATE office_holiday_overrides
          SET status = $1, decided_by = $2, decided_at = now(), decision_note = $3
        WHERE id = $4 AND status = 'PENDING'`,
      [accion === 'approve' ? 'APPROVED' : 'REJECTED', viewerId, nota.trim() || null, solicitudId],
    );
    return { ok: true };
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
    // Solo los aprobados: es lo único que mueve una fecha, y el índice parcial
    // `office_holiday_overrides_aprobados_idx` existe para esta consulta, que
    // corre en cada GET /snapshot. `isHolidayEffective` vuelve a filtrar por
    // estado —la regla vive ahí, no en este SELECT—, así que traer de más
    // sería correcto pero caro, y traer de menos no puede romperla.
    const [holidays, allOverrides] = await Promise.all([
      this.ctx.prisma.holiday.findMany(),
      this.ctx.query<OverrideDbRow>(
        `SELECT id, user_id, holiday_id, new_date, justification, status,
                decided_by, decided_at, decision_note
           FROM office_holiday_overrides WHERE status = 'APPROVED'`,
      ),
    ]);

    const holidayById = new Map((holidays as any[]).map(h => [h.id, h]));
    const overridesByUser = new Map<string, OverrideDbRow[]>();
    for (const o of allOverrides) {
      const list = overridesByUser.get(o.user_id) ?? [];
      list.push(o);
      overridesByUser.set(o.user_id, list);
    }

    const today = localDateString(now, tz);
    const result = new Map<string, string | null>();

    for (const [userId, country] of countryOf) {
      const userOverrides = overridesByUser.get(userId) ?? [];
      const on = isHolidayEffective({
        now,
        country,
        holidays: holidays as any as HolidayRow[],
        overrides: userOverrides.map(toOverrideRow),
        tz,
      });
      if (!on) continue;

      // ¿Cuál override, si alguno, es el que puso hoy como feriado? Solo esa
      // rama tiene justificación — un feriado fijo sin mover nunca la tiene.
      let justification: string | null = null;
      for (const o of userOverrides) {
        if (dateOnly(o.new_date) !== today) continue;
        const h = holidayById.get(o.holiday_id);
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
