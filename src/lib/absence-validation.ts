import { localDateString } from './local-date';
import { MIN_JUSTIFICATION, type AbsenceType, type ValidationError } from './status-rules';

export const ABSENCE_TYPES: AbsenceType[] = ['PERMISO', 'VACACIONES', 'INCAPACIDAD'];

export const NEEDS_ABSENCE_JUSTIFICATION = new Set<AbsenceType>([
  'PERMISO', 'INCAPACIDAD',
]);

/** Ausencias cuya justificación solo ven el dueño, su jefe y office.manage. */
export const RESTRICTED_ABSENCES = new Set<AbsenceType>([
  'PERMISO', 'INCAPACIDAD',
]);

/**
 * VACACIONES e INCAPACIDAD son de día completo: el servidor las normaliza a
 * 00:00:00/23:59:59.999 hora de la operación (ver `absence-bounds.ts`).
 * PERMISO lleva hora real y no se normaliza. Fuente única de esta
 * clasificación -- `absence-bounds.ts` la importa de acá en vez de tener su
 * propia copia.
 */
export const FULL_DAY_TYPES = new Set<AbsenceType>(['VACACIONES', 'INCAPACIDAD']);

export interface AbsenceWindow {
  type: AbsenceType;
  startAt: Date;
  endAt: Date;
  justification: string | null;
}

/**
 * El contrato de `startAt`/`endAt` difiere según `type`, y es a propósito:
 *  - VACACIONES/INCAPACIDAD (día completo): fecha PURA `"YYYY-MM-DD"`, sin
 *    hora ni zona. El cliente NO debe construir un `Date`/`toISOString()`
 *    para estos dos -- eso fue justo la regresión de la ola de arreglo
 *    final: el navegador convertía "medianoche local" a UTC con SU zona, y
 *    el anclaje del servidor (que ya asume que solo llega una fecha) le
 *    aplicaba una segunda conversión a una hora que ya había sido corrida
 *    una vez. Ver `absence-bounds.ts` para el anclaje real.
 *  - PERMISO: instante real (ISO datetime con hora), porque un permiso vive
 *    dentro de un día concreto y necesita la hora exacta.
 */
export interface AbsenceInput {
  type: string;
  startAt: string;
  endAt: string;
  justification?: string;
}

export function isAbsenceType(v: string): v is AbsenceType {
  return (ABSENCE_TYPES as string[]).includes(v);
}

export function validateAbsenceInput(input: AbsenceInput, tz: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isAbsenceType(input.type)) {
    return [{ field: 'type', message: `Tipo de ausencia inválido: ${input.type}` }];
  }
  const type = input.type;

  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return [{ field: 'startAt', message: 'Fechas inválidas' }];
  }
  // Los de día completo mandan fecha pura ("YYYY-MM-DD"): unas vacaciones de
  // UN SOLO día llegan con el mismo string en los dos campos, que al
  // parsear son el MISMO instante (medianoche UTC) -- así que ahí la
  // igualdad es válida, no un rango vacío. PERMISO manda hora real y sigue
  // exigiendo fin estrictamente posterior al inicio.
  const invalidRange = FULL_DAY_TYPES.has(type)
    ? endAt.getTime() < startAt.getTime()
    : endAt.getTime() <= startAt.getTime();
  if (invalidRange) {
    errors.push({ field: 'endAt', message: 'El fin debe ser posterior al inicio' });
  }

  // Un permiso es de unas horas dentro de un día, no de varios días.
  if (type === 'PERMISO' && localDateString(startAt, tz) !== localDateString(endAt, tz)) {
    errors.push({ field: 'endAt', message: 'Un permiso debe empezar y terminar el mismo día' });
  }

  const justification = (input.justification ?? '').trim();
  if (NEEDS_ABSENCE_JUSTIFICATION.has(type) && justification.length < MIN_JUSTIFICATION) {
    errors.push({
      field: 'justification',
      message: `La justificación debe tener al menos ${MIN_JUSTIFICATION} caracteres`,
    });
  }

  return errors;
}

/**
 * Primera ausencia que se solapa con el candidato, o null.
 * Los extremos se tratan como cerrados, así que terminar en el instante exacto
 * en que empieza la otra NO cuenta como solape: la anterior cierra en
 * 05:59:59.999Z y la siguiente abre en 06:00:00.000Z.
 */
export function findOverlap(
  candidate: { startAt: Date; endAt: Date },
  existing: AbsenceWindow[],
): AbsenceWindow | null {
  for (const a of existing) {
    if (candidate.startAt <= a.endAt && candidate.endAt >= a.startAt) return a;
  }
  return null;
}
