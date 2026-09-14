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

export interface AbsenceWindow {
  type: AbsenceType;
  startAt: Date;
  endAt: Date;
  justification: string | null;
}

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
  if (endAt.getTime() <= startAt.getTime()) {
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
