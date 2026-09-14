import { localDateString, sameLocalMonth } from './local-date';
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
 *  a. movió un feriado y hoy es la fecha nueva
 *  b. hoy hay un feriado de su país que NO movió
 *
 * El punto (b) es lo que hace funcionar el override: si lo movió, la fecha
 * original vuelve a ser día de trabajo.
 *
 * Las fechas de Holiday y HolidayOverride son columnas DATE sin hora ni zona,
 * así que se comparan como texto en UTC. "Hoy", en cambio, se calcula en la
 * zona de la operación.
 */
export function isHolidayEffective(args: HolidayEffectiveArgs): boolean {
  const { now, country, holidays, overrides, tz } = args;
  const today = localDateString(now, tz);

  const movedIds = new Set(overrides.map(o => o.holidayId));

  for (const o of overrides) {
    if (dateOnly(o.newDate) === today) return true;
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
  if (!sameLocalMonth(holidayDate, newDate, tz)) {
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

/** Parte de fecha de una columna DATE, que Prisma entrega a medianoche UTC. */
function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
