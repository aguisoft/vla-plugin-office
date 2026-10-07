import { describe, it, expect } from 'vitest';
import { canSeeJustification, canSeeTimeAlerts, type Viewer } from './justification-visibility';

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

describe('canSeeTimeAlerts — el color del cronómetro', () => {
  const viewer = (userId: string, hasManage = false, managed: string[] = []) =>
    ({ userId, hasManage, managedUserIds: new Set(managed) });

  it('uno siempre ve su propio semáforo', () => {
    expect(canSeeTimeAlerts(viewer('ana'), 'ana')).toBe(true);
  });

  it('el jefe directo ve el de su gente', () => {
    expect(canSeeTimeAlerts(viewer('carlos', false, ['ismael']), 'ismael')).toBe(true);
  });

  it('RRHH ve el de cualquiera', () => {
    expect(canSeeTimeAlerts(viewer('rrhh', true), 'ismael')).toBe(true);
  });

  it('un compañero sin jerarquía NO ve el semáforo ajeno', () => {
    expect(canSeeTimeAlerts(viewer('ana', false, []), 'ismael')).toBe(false);
  });

  it('ser jefe de uno no da acceso al semáforo de otro', () => {
    expect(canSeeTimeAlerts(viewer('carlos', false, ['dani']), 'ismael')).toBe(false);
  });
});

describe('la justificación de CITA_MEDICA es un dato de salud', () => {
  const viewer = (userId: string, hasManage = false, managed: string[] = []) =>
    ({ userId, hasManage, managedUserIds: new Set(managed) });

  it('un compañero no la ve', () => {
    expect(canSeeJustification(viewer('ana'), 'dani', 'CITA_MEDICA')).toBe(false);
  });

  it('la persona, su jefe y RRHH sí', () => {
    expect(canSeeJustification(viewer('dani'), 'dani', 'CITA_MEDICA')).toBe(true);
    expect(canSeeJustification(viewer('carlos', false, ['dani']), 'dani', 'CITA_MEDICA')).toBe(true);
    expect(canSeeJustification(viewer('rrhh', true), 'dani', 'CITA_MEDICA')).toBe(true);
  });
});
