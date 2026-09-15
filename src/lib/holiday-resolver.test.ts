import { describe, it, expect } from 'vitest';
import {
  isHolidayEffective,
  movableHolidays,
  validateOverrideInput,
  holidayMatchesCountry,
} from './holiday-resolver';
import { DEFAULT_TZ } from './local-date';

const TZ = DEFAULT_TZ;

// 15 de septiembre, Independencia de Costa Rica
const indep = { id: 'h1', date: new Date('2026-09-15T00:00:00Z'), country: 'CR', name: 'Independencia' };
// 1 de diciembre, Abolición del Ejército
const abol  = { id: 'h2', date: new Date('2026-12-01T00:00:00Z'), country: 'CR', name: 'Abolición' };
// 14 de septiembre, feriado de Nicaragua
const niBattle = { id: 'h3', date: new Date('2026-09-14T00:00:00Z'), country: 'NI', name: 'San Jacinto' };
// 1 de mayo, Día del Trabajo — cae el primer día del mes, el caso que
// sameLocalMonth desplazaba en zonas detrás de UTC (América/Costa_Rica, UTC-6)
const mayDay = { id: 'h4', date: new Date('2026-05-01T00:00:00Z'), country: 'CR', name: 'Día del Trabajo' };
// 1 de enero, Año Nuevo — mismo caso de borde, además cruzando de año
const newYear = { id: 'h5', date: new Date('2026-01-01T00:00:00Z'), country: 'CR', name: 'Año Nuevo' };

const noon = (iso: string) => new Date(iso);

describe('isHolidayEffective', () => {
  it('aplica el feriado del país del colaborador', () => {
    expect(isHolidayEffective({
      now: noon('2026-09-15T18:00:00Z'),
      country: 'CR',
      holidays: [indep],
      overrides: [],
      tz: TZ,
    })).toBe(true);
  });

  it('no aplica el feriado de otro país', () => {
    expect(isHolidayEffective({
      now: noon('2026-09-14T18:00:00Z'),
      country: 'CR',
      holidays: [niBattle],
      overrides: [],
      tz: TZ,
    })).toBe(false);
  });

  it('no aplica en un día que no es feriado', () => {
    expect(isHolidayEffective({
      now: noon('2026-09-16T18:00:00Z'),
      country: 'CR',
      holidays: [indep],
      overrides: [],
      tz: TZ,
    })).toBe(false);
  });

  it('con override, la fecha original deja de ser feriado', () => {
    expect(isHolidayEffective({
      now: noon('2026-09-15T18:00:00Z'),
      country: 'CR',
      holidays: [indep],
      overrides: [{ holidayId: 'h1', newDate: new Date('2026-09-25T00:00:00Z') }],
      tz: TZ,
    })).toBe(false);
  });

  it('con override, la fecha nueva sí es feriado', () => {
    expect(isHolidayEffective({
      now: noon('2026-09-25T18:00:00Z'),
      country: 'CR',
      holidays: [indep],
      overrides: [{ holidayId: 'h1', newDate: new Date('2026-09-25T00:00:00Z') }],
      tz: TZ,
    })).toBe(true);
  });

  it('un override no afecta a los otros feriados', () => {
    expect(isHolidayEffective({
      now: noon('2026-12-01T18:00:00Z'),
      country: 'CR',
      holidays: [indep, abol],
      overrides: [{ holidayId: 'h1', newDate: new Date('2026-09-25T00:00:00Z') }],
      tz: TZ,
    })).toBe(true);
  });

  it('usa el día local y no el de UTC a las 23:00 locales', () => {
    // 2026-09-16T05:00:00Z son las 23:00 del 15 en Costa Rica: sigue siendo feriado
    expect(isHolidayEffective({
      now: noon('2026-09-16T05:00:00Z'),
      country: 'CR',
      holidays: [indep],
      overrides: [],
      tz: TZ,
    })).toBe(true);
  });

  it('un override sobre el feriado de OTRO país no concede nada', () => {
    // Pasa si RRHH corrige el país de alguien y le quedan overrides viejos.
    expect(isHolidayEffective({
      now: noon('2026-09-20T18:00:00Z'),
      country: 'CR',
      holidays: [niBattle],
      overrides: [{ holidayId: 'h3', newDate: new Date('2026-09-20T00:00:00Z') }],
      tz: TZ,
    })).toBe(false);
  });

  it('un override huérfano, sin su feriado en la lista, no concede nada', () => {
    expect(isHolidayEffective({
      now: noon('2026-09-20T18:00:00Z'),
      country: 'CR',
      holidays: [],
      overrides: [{ holidayId: 'borrado', newDate: new Date('2026-09-20T00:00:00Z') }],
      tz: TZ,
    })).toBe(false);
  });
});

describe('movableHolidays', () => {
  it('lista los feriados del país que no se movieron', () => {
    const r = movableHolidays([indep, abol, niBattle], [], 'CR');
    expect(r.map(h => h.id)).toEqual(['h1', 'h2']);
  });

  it('excluye el que ya se movió', () => {
    const r = movableHolidays([indep, abol], [{ holidayId: 'h1', newDate: new Date() }], 'CR');
    expect(r.map(h => h.id)).toEqual(['h2']);
  });
});

describe('validateOverrideInput', () => {
  const JUST = 'tomo el feriado el viernes siguiente';

  it('acepta otra fecha del mismo mes', () => {
    expect(validateOverrideInput(
      indep.date, new Date('2026-09-25T00:00:00Z'), JUST, TZ,
    )).toEqual([]);
  });

  it('rechaza una fecha de otro mes', () => {
    expect(validateOverrideInput(
      indep.date, new Date('2026-10-02T00:00:00Z'), JUST, TZ,
    ).map(e => e.field)).toContain('newDate');
  });

  it('rechaza el mismo mes de otro año', () => {
    expect(validateOverrideInput(
      indep.date, new Date('2027-09-25T00:00:00Z'), JUST, TZ,
    ).map(e => e.field)).toContain('newDate');
  });

  it('exige justificación', () => {
    expect(validateOverrideInput(
      indep.date, new Date('2026-09-25T00:00:00Z'), 'x', TZ,
    ).map(e => e.field)).toContain('justification');
  });

  // holidayDate y newDate son columnas @db.Date (medianoche UTC, sin hora
  // real). En América/Costa_Rica (UTC-6, el DEFAULT_TZ) un desplazamiento por
  // zona leería el 1 de mayo como 30 de abril, y el 1 de enero como 31 de
  // diciembre del año anterior — exactamente al revés de lo correcto.

  it('el 1 de mayo se puede mover al 15 de mayo (mismo mes, sin desplazar por zona)', () => {
    expect(validateOverrideInput(
      mayDay.date, new Date('2026-05-15T00:00:00Z'), JUST, TZ,
    )).toEqual([]);
  });

  it('el 1 de mayo NO se puede mover al 30 de abril (mes distinto)', () => {
    expect(validateOverrideInput(
      mayDay.date, new Date('2026-04-30T00:00:00Z'), JUST, TZ,
    ).map(e => e.field)).toContain('newDate');
  });

  it('el 1 de enero se puede mover al 15 de enero (mismo mes)', () => {
    expect(validateOverrideInput(
      newYear.date, new Date('2026-01-15T00:00:00Z'), JUST, TZ,
    )).toEqual([]);
  });

  it('el 1 de enero NO se puede mover al 31 de diciembre del año anterior', () => {
    expect(validateOverrideInput(
      newYear.date, new Date('2025-12-31T00:00:00Z'), JUST, TZ,
    ).map(e => e.field)).toContain('newDate');
  });
});

describe('holidayMatchesCountry', () => {
  it('true cuando el feriado es del país del colaborador', () => {
    expect(holidayMatchesCountry(indep, 'CR')).toBe(true);
  });

  it('false cuando el feriado es de otro país', () => {
    expect(holidayMatchesCountry(niBattle, 'CR')).toBe(false);
  });
});
