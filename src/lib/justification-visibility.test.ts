import { describe, it, expect } from 'vitest';
import { canSeeJustification, type Viewer } from './justification-visibility';

const ana: Viewer   = { userId: 'ana',   hasManage: false, managedUserIds: new Set() };
const jefe: Viewer  = { userId: 'jefe',  hasManage: false, managedUserIds: new Set(['ana']) };
const rrhh: Viewer  = { userId: 'rrhh',  hasManage: true,  managedUserIds: new Set() };
const ajeno: Viewer = { userId: 'ajeno', hasManage: false, managedUserIds: new Set() };

describe('canSeeJustification — estados públicos', () => {
  for (const s of ['FOCUS', 'IN_MEETING_INTERNAL', 'IN_MEETING_EXTERNAL', 'BRB', 'FERIADO'] as const) {
    it(`cualquiera ve la de ${s}`, () => {
      expect(canSeeJustification(ajeno, 'ana', s)).toBe(true);
    });
  }
});

describe('canSeeJustification — estados restringidos', () => {
  for (const s of ['PERMISO', 'INCAPACIDAD'] as const) {
    it(`${s}: el dueño sí`, () => {
      expect(canSeeJustification(ana, 'ana', s)).toBe(true);
    });

    it(`${s}: el jefe directo sí`, () => {
      expect(canSeeJustification(jefe, 'ana', s)).toBe(true);
    });

    it(`${s}: office.manage sí`, () => {
      expect(canSeeJustification(rrhh, 'ana', s)).toBe(true);
    });

    it(`${s}: un tercero no`, () => {
      expect(canSeeJustification(ajeno, 'ana', s)).toBe(false);
    });

    it(`${s}: el jefe de OTRA persona no`, () => {
      expect(canSeeJustification(jefe, 'beto', s)).toBe(false);
    });
  }
});

describe('canSeeJustification — estados sin justificación', () => {
  it('AVAILABLE no tiene nada que mostrar', () => {
    expect(canSeeJustification(ajeno, 'ana', 'AVAILABLE')).toBe(false);
  });

  it('VACACIONES no lleva justificación', () => {
    expect(canSeeJustification(ajeno, 'ana', 'VACACIONES')).toBe(false);
  });

  it('el dueño tampoco ve una que no existe', () => {
    expect(canSeeJustification(ana, 'ana', 'VACACIONES')).toBe(false);
  });
});
