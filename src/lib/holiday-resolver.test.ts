import { describe, it, expect } from 'vitest';
import {
  isHolidayEffective,
  movableHolidays,
  validateOverrideInput,
} from './holiday-resolver';
import { DEFAULT_TZ } from './local-date';

const TZ = DEFAULT_TZ;

// 15 de septiembre, Independencia de Costa Rica
const indep = { id: 'h1', date: new Date('2026-09-15T00:00:00Z'), country: 'CR', name: 'Independencia' };
// 1 de diciembre, Abolición del Ejército
const abol  = { id: 'h2', date: new Date('2026-12-01T00:00:00Z'), country: 'CR', name: 'Abolición' };
// 14 de septiembre, feriado de Nicaragua
const niBattle = { id: 'h3', date: new Date('2026-09-14T00:00:00Z'), country: 'NI', name: 'San Jacinto' };

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
});
