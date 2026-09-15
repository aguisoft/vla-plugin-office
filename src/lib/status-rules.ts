import { localDateString } from './local-date';

export type OfficeStatus =
  | 'AVAILABLE'
  | 'IN_MEETING_INTERNAL'
  | 'IN_MEETING_EXTERNAL'
  | 'FOCUS'
  | 'LUNCH'
  | 'BRB'
  | 'OFFLINE';

export type AbsenceType = 'PERMISO' | 'VACACIONES' | 'INCAPACIDAD';

/** Lo que ve la oficina: estado del día, ausencia o feriado. */
export type ResolvedStatus = OfficeStatus | AbsenceType | 'FERIADO';

export const MIN_JUSTIFICATION = 10;

export const ALL_STATUSES: OfficeStatus[] = [
  'AVAILABLE', 'IN_MEETING_INTERNAL', 'IN_MEETING_EXTERNAL',
  'FOCUS', 'LUNCH', 'BRB', 'OFFLINE',
];

/** Lo que el colaborador puede elegir. OFFLINE lo escribe solo el sistema. */
export const SELECTABLE_STATUSES: OfficeStatus[] = ALL_STATUSES
  .filter(s => s !== 'OFFLINE');

export const NEEDS_JUSTIFICATION = new Set<OfficeStatus>([
  'FOCUS', 'IN_MEETING_INTERNAL', 'IN_MEETING_EXTERNAL', 'BRB',
]);

export const NEEDS_TIME_RANGE = new Set<OfficeStatus>(['LUNCH']);

/** Estados cuya justificación puede leer cualquiera con office.view. */
export const PUBLIC_JUSTIFICATION = new Set<ResolvedStatus>([
  'FOCUS', 'IN_MEETING_INTERNAL', 'IN_MEETING_EXTERNAL', 'BRB', 'FERIADO',
]);

export interface StatusInput {
  status: string;
  justification?: string;
  startsAt?: string;
  endsAt?: string;
  participantIds?: string[];
}

export interface ValidationError {
  field: string;
  message: string;
}

export function isOfficeStatus(v: string): v is OfficeStatus {
  return (ALL_STATUSES as string[]).includes(v);
}

export function validateStatusInput(input: StatusInput, tz: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isOfficeStatus(input.status)) {
    return [{ field: 'status', message: `Estado inválido: ${input.status}` }];
  }
  if (input.status === 'OFFLINE') {
    return [{ field: 'status', message: 'OFFLINE lo escribe solo el sistema' }];
  }

  const status = input.status;

  // ── Justificación ────────────────────────────────────────────────────────
  const justification = (input.justification ?? '').trim();
  if (NEEDS_JUSTIFICATION.has(status)) {
    if (justification.length < MIN_JUSTIFICATION) {
      errors.push({
        field: 'justification',
        message: `La justificación debe tener al menos ${MIN_JUSTIFICATION} caracteres`,
      });
    }
  }

  // ── Rango de hora ────────────────────────────────────────────────────────
  const wantsRange = NEEDS_TIME_RANGE.has(status);
  if (wantsRange) {
    if (!input.startsAt || !input.endsAt) {
      errors.push({ field: 'startsAt', message: 'Hay que indicar la hora de inicio y de fin' });
    } else {
      const start = new Date(input.startsAt);
      const end = new Date(input.endsAt);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        errors.push({ field: 'startsAt', message: 'Fechas inválidas' });
      } else if (end.getTime() <= start.getTime()) {
        errors.push({ field: 'endsAt', message: 'La hora de fin debe ser posterior a la de inicio' });
      } else if (localDateString(start, tz) !== localDateString(end, tz)) {
        errors.push({ field: 'endsAt', message: 'El rango debe caer en un solo día' });
      }
    }
  } else if (input.startsAt || input.endsAt) {
    errors.push({ field: 'startsAt', message: `${status} no admite rango de hora` });
  }

  // ── Participantes ────────────────────────────────────────────────────────
  const participants = input.participantIds;
  if (participants && participants.length > 0) {
    if (status !== 'IN_MEETING_INTERNAL') {
      errors.push({
        field: 'participantIds',
        message: 'Solo se pueden indicar participantes en una reunión interna',
      });
    } else if (new Set(participants).size !== participants.length) {
      errors.push({ field: 'participantIds', message: 'Hay participantes repetidos' });
    }
  }

  return errors;
}
