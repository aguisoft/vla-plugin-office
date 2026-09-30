import { localDateString } from './local-date';
import { MIN_JUSTIFICATION, type ValidationError } from './status-rules';

export interface HolidayRow {
  id: string;
  date: Date;
  country: string;
  name: string;
}

/**
 * Mover un feriado es una SOLICITUD, no un hecho: la aprueba el jefe directo.
 * Solo `APPROVED` corre la fecha. `PENDING` y `REJECTED` no mueven nada, y esa
 * distinción es la que sostiene todo lo de abajo.
 */
export type OverrideStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface OverrideRow {
  holidayId: string;
  newDate: Date;
  status: OverrideStatus;
}

/**
 * Los únicos que corren una fecha. Se usa en las dos ramas de
 * `isHolidayEffective` —conceder la fecha nueva y quitar la original— porque
 * aplicarlo en una sola dejaría el peor estado posible: una solicitud sin
 * aprobar que le borra el feriado real a quien la pidió.
 */
function aprobados(overrides: OverrideRow[]): OverrideRow[] {
  return overrides.filter(o => o.status === 'APPROVED');
}

export interface HolidayEffectiveArgs {
  now: Date;
  country: string;
  holidays: HolidayRow[];
  overrides: OverrideRow[];
  tz: string;
}

/**
 * ¿Hoy es feriado para este colaborador?
 *
 * Dos caminos dan true:
 *  a. movió un feriado de su país y hoy es la fecha nueva
 *  b. hoy hay un feriado de su país que NO movió
 *
 * El filtro de país va en ambas ramas: si RRHH corrige el país de un colaborador,
 * le quedan overrides viejos apuntando a feriados del país anterior.
 *
 * Las fechas de Holiday y HolidayOverride son columnas DATE sin hora ni zona,
 * así que se comparan como texto en UTC. "Hoy", en cambio, se calcula en la
 * zona de la operación.
 */
export function isHolidayEffective(args: HolidayEffectiveArgs): boolean {
  const { now, country, holidays, overrides, tz } = args;
  const today = localDateString(now, tz);

  const byId = new Map(holidays.map(h => [h.id, h]));
  // Solo un override aprobado mueve el feriado. Mientras el jefe no responde,
  // la fecha original sigue siendo feriado: pedirlo no es tenerlo.
  const vigentes = aprobados(overrides);
  const movedIds = new Set(vigentes.map(o => o.holidayId));

  for (const o of vigentes) {
    if (dateOnly(o.newDate) !== today) continue;
    // Un override huérfano (feriado borrado) no concede nada.
    const h = byId.get(o.holidayId);
    if (h && h.country === country) return true;
  }

  for (const h of holidays) {
    if (h.country !== country) continue;
    if (movedIds.has(h.id)) continue;
    if (dateOnly(h.date) === today) return true;
  }

  return false;
}

/**
 * Feriados del país que el colaborador todavía puede pedir mover.
 *
 * Se excluyen tanto los aprobados como los PENDIENTES: con una solicitud en
 * curso no hay nada que volver a pedir, y ofrecerla otra vez invitaría a
 * pisar la que el jefe está por mirar. Un RECHAZADO sí vuelve a la lista —
 * ese es el camino para proponer otra fecha después de un "no".
 */
export function movableHolidays(
  holidays: HolidayRow[],
  overrides: OverrideRow[],
  country: string,
): HolidayRow[] {
  const tomados = new Set(
    overrides.filter(o => o.status !== 'REJECTED').map(o => o.holidayId),
  );
  return holidays.filter(h => h.country === country && !tomados.has(h.id));
}

/**
 * Fechas (`YYYY-MM-DD`) en que ESTA persona tiene feriado, ya corridas por sus
 * overrides aprobados. Alimenta el denominador de días hábiles del tablero.
 *
 * Existe porque el denominador descontaba el feriado NACIONAL y nunca el
 * movido, y eso castigaba justo a quien hizo lo correcto: quien corrió su
 * feriado del martes al viernes aparecía trabajando el martes (fuera de días
 * hábiles) y ausente el viernes, o sea un día menos. La regla del mismo mes
 * mantiene el CONTEO correcto, pero el tablero mira el DÍA.
 */
export function effectiveHolidayDates(
  holidays: HolidayRow[],
  overrides: OverrideRow[],
  country: string,
): Set<string> {
  const delPais = holidays.filter(h => h.country === country);
  const byId = new Map(delPais.map(h => [h.id, h]));
  // Un override de otro país (RRHH corrigió el país después de aprobarlo) no
  // concede ni quita nada, igual que en isHolidayEffective.
  const vigentes = aprobados(overrides).filter(o => byId.has(o.holidayId));
  const movidos = new Set(vigentes.map(o => o.holidayId));

  const fechas = new Set<string>();
  for (const h of delPais) {
    if (!movidos.has(h.id)) fechas.add(dateOnly(h.date));
  }
  for (const o of vigentes) fechas.add(dateOnly(o.newDate));
  return fechas;
}

/**
 * ¿Este feriado es del país del colaborador? Defensa en la ESCRITURA para
 * setOverride: sin ella se podría crear un override apuntando a un feriado
 * de otro país. Es el complemento de isHolidayEffective, que ya filtra por
 * país al LEER (Task 8, Ruling 10) — hacen falta las dos porque el país del
 * colaborador puede cambiar después de creado el override.
 */
export function holidayMatchesCountry(holiday: HolidayRow, country: string): boolean {
  return holiday.country === country;
}

export type DecisionReason = 'not_found' | 'not_yours' | 'not_pending';

export interface SolicitudDecidible {
  userId: string;
  status: OverrideStatus;
}

/**
 * ¿Puede este usuario decidir sobre esta solicitud?
 *
 * Mismas razones tipadas que `meeting-invites.respond`, y el endpoint las mapea
 * a los mismos códigos (404 / 403 / 409) para que el plugin hable un solo
 * idioma de errores.
 *
 * `esJefeDirecto` llega resuelto de `OrgService.isManagerOf`, que ya devuelve
 * false cuando el que mira es el mismo que pidió. Igual se chequea acá la
 * identidad: esta función es la que define la regla, y una regla que depende
 * de que OTRO la haya chequeado antes es una regla que un día se rompe sola.
 */
export function puedeDecidir(
  solicitud: SolicitudDecidible | null,
  viewerId: string,
  esJefeDirecto: boolean,
): { ok: true } | { ok: false; reason: DecisionReason } {
  if (!solicitud) return { ok: false, reason: 'not_found' };
  if (solicitud.userId === viewerId) return { ok: false, reason: 'not_yours' };
  if (!esJefeDirecto) return { ok: false, reason: 'not_yours' };
  if (solicitud.status !== 'PENDING') return { ok: false, reason: 'not_pending' };
  return { ok: true };
}

/**
 * Rechazar exige nota. Aprobar no: el "sí" no necesita defensa, el "no" sí —
 * quien se quedó sin mover su feriado tiene que poder leer por qué.
 */
export function validateDecision(
  accion: 'approve' | 'reject',
  nota: string,
): ValidationError[] {
  if (accion === 'approve') return [];
  if ((nota ?? '').trim().length < MIN_JUSTIFICATION) {
    return [{
      field: 'decisionNote',
      message: `Para rechazar hay que explicar por qué, con al menos ${MIN_JUSTIFICATION} caracteres`,
    }];
  }
  return [];
}

export function validateOverrideInput(
  holidayDate: Date,
  newDate: Date,
  justification: string,
  tz: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (Number.isNaN(newDate.getTime())) {
    return [{ field: 'newDate', message: 'Fecha inválida' }];
  }
  // holidayDate y newDate son columnas @db.Date (medianoche UTC, sin hora
  // real): se comparan como fechas de calendario en UTC, igual que dateOnly()
  // más abajo. NO pasan por sameLocalMonth/tz — eso las trataría como
  // instantes y las desplazaría un día en cualquier zona detrás de UTC (ej.
  // América/Costa_Rica, UTC-6): un feriado del día 1 se leería como el
  // último día del mes anterior.
  if (!sameCalendarMonth(holidayDate, newDate)) {
    errors.push({
      field: 'newDate',
      message: 'El feriado solo se puede mover a otra fecha del mismo mes',
    });
  }
  if ((justification ?? '').trim().length < MIN_JUSTIFICATION) {
    errors.push({
      field: 'justification',
      message: `La justificación debe tener al menos ${MIN_JUSTIFICATION} caracteres`,
    });
  }

  return errors;
}

/**
 * Parte de fecha de una columna DATE, que Prisma entrega a medianoche UTC.
 * Exportada porque holiday.service.ts la necesita para encontrar CUÁL
 * override cae hoy (y así devolver su justificación) con la misma regla que
 * usa el booleano de acá adentro — sin reimplementarla ni pedirla a la base
 * una segunda vez.
 */
export function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Año y mes (UTC) de una columna DATE, sin desplazar por zona. */
function sameCalendarMonth(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 7) === b.toISOString().slice(0, 7);
}

/**
 * Bordes del mes en UTC. Ensanchan el rango con que se piden los feriados,
 * porque un override mueve la fecha DENTRO del mes y el período consultado
 * puede partirlo (ver `HolidayService.effectiveDatesByUser`).
 */
export function inicioDeMes(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function finDeMes(d: Date): Date {
  // Día 0 del mes siguiente es el último del actual, y sirve para diciembre
  // sin tratar el cambio de año como caso aparte.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}
