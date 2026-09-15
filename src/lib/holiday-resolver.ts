import { localDateString } from './local-date';
import { MIN_JUSTIFICATION, type ValidationError } from './status-rules';

export interface HolidayRow {
  id: string;
  date: Date;
  country: string;
  name: string;
}

export interface OverrideRow {
  holidayId: string;
  newDate: Date;
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
  const movedIds = new Set(overrides.map(o => o.holidayId));

  for (const o of overrides) {
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

/** Feriados del país que el colaborador todavía puede mover. */
export function movableHolidays(
  holidays: HolidayRow[],
  overrides: OverrideRow[],
  country: string,
): HolidayRow[] {
  const movedIds = new Set(overrides.map(o => o.holidayId));
  return holidays.filter(h => h.country === country && !movedIds.has(h.id));
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
