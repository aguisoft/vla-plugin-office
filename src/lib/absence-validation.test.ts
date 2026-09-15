import { describe, it, expect } from 'vitest';
import { validateAbsenceInput, findOverlap } from './absence-validation';
import { DEFAULT_TZ } from './local-date';

const TZ = DEFAULT_TZ;
const fields = (i: any) => validateAbsenceInput(i, TZ).map(e => e.field);
const JUST = 'cita médica en la CCSS';

describe('validateAbsenceInput — tipo', () => {
  it('rechaza un tipo que no existe', () => {
    expect(fields({ type: 'FERIADO', startAt: '2026-09-14T06:00:00Z', endAt: '2026-09-15T05:59:59Z' }))
      .toContain('type');
  });
});

describe('validateAbsenceInput — rango', () => {
  it('exige fin posterior al inicio', () => {
    expect(fields({
      type: 'VACACIONES',
      startAt: '2026-09-20T06:00:00Z',
      endAt: '2026-09-14T06:00:00Z',
    })).toContain('endAt');
  });

  it('acepta vacaciones de varios días', () => {
    expect(validateAbsenceInput({
      type: 'VACACIONES',
      startAt: '2026-11-03T06:00:00Z',
      endAt: '2026-11-15T05:59:59.999Z',
    }, TZ)).toEqual([]);
  });

  it('acepta un solo día de vacaciones -- fecha pura, mismo string en los dos campos', () => {
    // El contrato de día completo manda "YYYY-MM-DD" sin hora (ver
    // AbsenceInput). Un rango de un solo día llega con el MISMO string en
    // startAt/endAt, que al parsear son el mismo instante -- eso es válido,
    // no un rango vacío. Es justo lo que rompía la comparación estricta
    // `<=` de antes de la ola de arreglo final.
    expect(validateAbsenceInput({
      type: 'VACACIONES',
      startAt: '2026-09-15',
      endAt: '2026-09-15',
    }, TZ)).toEqual([]);
  });

  it('acepta una sola incapacidad de un día -- misma fecha pura en los dos campos', () => {
    expect(validateAbsenceInput({
      type: 'INCAPACIDAD',
      startAt: '2026-09-15',
      endAt: '2026-09-15',
      justification: JUST,
    }, TZ)).toEqual([]);
  });

  it('PERMISO sigue exigiendo fin ESTRICTAMENTE posterior -- el mismo instante no vale', () => {
    expect(fields({
      type: 'PERMISO',
      startAt: '2026-09-14T20:00:00Z',
      endAt: '2026-09-14T20:00:00Z',
      justification: JUST,
    })).toContain('endAt');
  });
});

describe('validateAbsenceInput — PERMISO', () => {
  it('acepta un permiso de unas horas del mismo día', () => {
    expect(validateAbsenceInput({
      type: 'PERMISO',
      startAt: '2026-09-14T20:00:00Z', // 14:00 local
      endAt: '2026-09-14T23:00:00Z',   // 17:00 local
      justification: JUST,
    }, TZ)).toEqual([]);
  });

  it('rechaza un permiso que cruza de día local', () => {
    expect(fields({
      type: 'PERMISO',
      startAt: '2026-09-14T20:00:00Z',
      endAt: '2026-09-15T20:00:00Z',
      justification: JUST,
    })).toContain('endAt');
  });

  it('exige justificación', () => {
    expect(fields({
      type: 'PERMISO',
      startAt: '2026-09-14T20:00:00Z',
      endAt: '2026-09-14T23:00:00Z',
    })).toContain('justification');
  });
});

describe('validateAbsenceInput — justificación', () => {
  it('INCAPACIDAD la exige', () => {
    expect(fields({
      type: 'INCAPACIDAD',
      startAt: '2026-09-14T06:00:00Z',
      endAt: '2026-09-19T05:59:59Z',
    })).toContain('justification');
  });

  it('VACACIONES no la exige', () => {
    expect(validateAbsenceInput({
      type: 'VACACIONES',
      startAt: '2026-11-03T06:00:00Z',
      endAt: '2026-11-15T05:59:59.999Z',
    }, TZ)).toEqual([]);
  });

  it('rechaza justificación corta en INCAPACIDAD', () => {
    expect(fields({
      type: 'INCAPACIDAD',
      startAt: '2026-09-14T06:00:00Z',
      endAt: '2026-09-19T05:59:59Z',
      justification: 'gripe',
    })).toContain('justification');
  });
});

describe('findOverlap', () => {
  const existing = [{
    type: 'VACACIONES' as const,
    startAt: new Date('2026-11-03T06:00:00Z'),
    endAt: new Date('2026-11-15T05:59:59.999Z'),
    justification: null,
  }];

  it('detecta solape parcial por el inicio', () => {
    expect(findOverlap({
      startAt: new Date('2026-11-01T06:00:00Z'),
      endAt: new Date('2026-11-05T05:59:59Z'),
    }, existing)).toBe(existing[0]);
  });

  it('detecta contención completa', () => {
    expect(findOverlap({
      startAt: new Date('2026-11-05T06:00:00Z'),
      endAt: new Date('2026-11-07T05:59:59Z'),
    }, existing)).toBe(existing[0]);
  });

  it('null cuando termina justo antes de que empiece la otra', () => {
    expect(findOverlap({
      startAt: new Date('2026-11-01T06:00:00Z'),
      endAt: new Date('2026-11-03T05:59:59.999Z'),
    }, existing)).toBeNull();
  });

  it('null cuando empieza después', () => {
    expect(findOverlap({
      startAt: new Date('2026-11-16T06:00:00Z'),
      endAt: new Date('2026-11-20T05:59:59Z'),
    }, existing)).toBeNull();
  });

  it('null con lista vacía', () => {
    expect(findOverlap({
      startAt: new Date('2026-11-01T06:00:00Z'),
      endAt: new Date('2026-11-05T06:00:00Z'),
    }, [])).toBeNull();
  });
});
