import type { AbsenceWindow } from './absence-validation';
import type { OfficeStatus, ResolvedStatus } from './status-rules';

export interface ResolveInput {
  presenceStatus: OfficeStatus;
  presenceJustification: string | null;
  absences: AbsenceWindow[];
  isHolidayToday: boolean;
  now: Date;
}

export interface Resolved {
  status: ResolvedStatus;
  justification: string | null;
  isAbsent: boolean;
  absenceEndsAt: Date | null;
}

/** Primera ausencia que cubre el instante dado. Extremos incluidos. */
export function activeAbsence(absences: AbsenceWindow[], now: Date): AbsenceWindow | null {
  for (const a of absences) {
    if (now >= a.startAt && now <= a.endAt) return a;
  }
  return null;
}

/**
 * Estado que ve la oficina. Precedencia: ausencia > feriado > estado del día.
 *
 * Las ausencias y los feriados nunca se escriben en PresenceStatus.status: se
 * calculan acá. Por eso el cron de timeman puede seguir moviendo el estado del
 * día sin pisar una ausencia.
 */
export function resolveStatus(input: ResolveInput): Resolved {
  const absence = activeAbsence(input.absences, input.now);
  if (absence) {
    return {
      status: absence.type,
      justification: absence.justification,
      isAbsent: true,
      absenceEndsAt: absence.endAt,
    };
  }

  if (input.isHolidayToday) {
    return {
      status: 'FERIADO',
      justification: null,
      isAbsent: true,
      absenceEndsAt: null,
    };
  }

  return {
    status: input.presenceStatus,
    justification: input.presenceJustification,
    isAbsent: false,
    absenceEndsAt: null,
  };
}
