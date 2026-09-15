import { describe, it, expect } from 'vitest';
import { resolveStatus, activeAbsence } from './state-resolver';
import type { AbsenceWindow } from './absence-validation';

const NOW = new Date('2026-09-14T18:00:00Z'); // mediodía local

const vacaciones: AbsenceWindow = {
  type: 'VACACIONES',
  startAt: new Date('2026-09-10T06:00:00Z'),
  endAt: new Date('2026-09-20T05:59:59.999Z'),
  justification: null,
};

const incapacidad: AbsenceWindow = {
  type: 'INCAPACIDAD',
  startAt: new Date('2026-09-14T06:00:00Z'),
  endAt: new Date('2026-09-19T05:59:59.999Z'),
  justification: 'Boleta CCSS 4477-2026',
};

const base = {
  presenceStatus: 'AVAILABLE' as const,
  presenceJustification: null,
  absences: [],
  isHolidayToday: false,
  now: NOW,
};

describe('resolveStatus — precedencia', () => {
  it('sin ausencia ni feriado, devuelve el estado del día', () => {
    const r = resolveStatus({ ...base, presenceStatus: 'FOCUS', presenceJustification: 'cerrando reporte' });
    expect(r.status).toBe('FOCUS');
    expect(r.justification).toBe('cerrando reporte');
    expect(r.isAbsent).toBe(false);
  });

  it('la ausencia activa gana sobre el estado del día', () => {
    const r = resolveStatus({ ...base, presenceStatus: 'AVAILABLE', absences: [vacaciones] });
    expect(r.status).toBe('VACACIONES');
    expect(r.isAbsent).toBe(true);
  });

  it('el feriado gana sobre el estado del día', () => {
    const r = resolveStatus({ ...base, presenceStatus: 'AVAILABLE', isHolidayToday: true });
    expect(r.status).toBe('FERIADO');
    expect(r.isAbsent).toBe(true);
  });

  it('la ausencia gana sobre el feriado cuando se solapan', () => {
    const r = resolveStatus({ ...base, absences: [incapacidad], isHolidayToday: true });
    expect(r.status).toBe('INCAPACIDAD');
  });

  it('expone la justificación de la ausencia, no la del estado del día', () => {
    const r = resolveStatus({
      ...base,
      presenceStatus: 'FOCUS',
      presenceJustification: 'algo del día',
      absences: [incapacidad],
    });
    expect(r.justification).toBe('Boleta CCSS 4477-2026');
  });

  it('expone cuándo vuelve', () => {
    const r = resolveStatus({ ...base, absences: [vacaciones] });
    expect(r.absenceEndsAt?.toISOString()).toBe('2026-09-20T05:59:59.999Z');
  });

  it('el feriado no tiene fecha de regreso', () => {
    const r = resolveStatus({ ...base, isHolidayToday: true });
    expect(r.absenceEndsAt).toBeNull();
  });
});

describe('activeAbsence', () => {
  it('ignora una ausencia que ya venció', () => {
    const vencida: AbsenceWindow = {
      ...vacaciones,
      startAt: new Date('2026-08-01T06:00:00Z'),
      endAt: new Date('2026-08-10T05:59:59Z'),
    };
    expect(activeAbsence([vencida], NOW)).toBeNull();
  });

  it('ignora una ausencia futura', () => {
    const futura: AbsenceWindow = {
      ...vacaciones,
      startAt: new Date('2026-11-03T06:00:00Z'),
      endAt: new Date('2026-11-15T05:59:59Z'),
    };
    expect(activeAbsence([futura], NOW)).toBeNull();
  });

  it('incluye los extremos', () => {
    expect(activeAbsence([vacaciones], vacaciones.startAt)).toBe(vacaciones);
    expect(activeAbsence([vacaciones], vacaciones.endAt)).toBe(vacaciones);
  });

  it('con varias activas devuelve la primera', () => {
    expect(activeAbsence([vacaciones, incapacidad], NOW)).toBe(vacaciones);
  });

  it('null con lista vacía', () => {
    expect(activeAbsence([], NOW)).toBeNull();
  });
});
