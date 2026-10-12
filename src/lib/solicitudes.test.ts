import { describe, it, expect } from 'vitest';
import { valeMientrasPendiente, estadoInicial, puedeResolver, transicion, textoRango } from './solicitudes';

describe('valeMientrasPendiente', () => {
  it('permiso, cita e incapacidad valen ya; vacaciones esperan', () => {
    expect(['PERMISO', 'CITA_MEDICA', 'INCAPACIDAD'].map(valeMientrasPendiente)).toEqual([true, true, true]);
    expect(valeMientrasPendiente('VACACIONES')).toBe(false);
  });
});

describe('estadoInicial', () => {
  it('normal: pendiente (con o sin jefe: sin jefe la ve RRHH)', () => {
    expect(estadoInicial({ cargadaPorRrhhParaOtro: false, tieneJefe: true, solicitanteEsRrhh: false })).toBe('pendiente');
    expect(estadoInicial({ cargadaPorRrhhParaOtro: false, tieneJefe: false, solicitanteEsRrhh: false })).toBe('pendiente');
  });
  it('la carga RRHH para otra persona, o RRHH sin jefe: aprobada', () => {
    expect(estadoInicial({ cargadaPorRrhhParaOtro: true, tieneJefe: true, solicitanteEsRrhh: false })).toBe('aprobada');
    expect(estadoInicial({ cargadaPorRrhhParaOtro: false, tieneJefe: false, solicitanteEsRrhh: true })).toBe('aprobada');
  });
});

describe('puedeResolver', () => {
  it('el jefe directo o RRHH; nadie la suya', () => {
    expect(puedeResolver({ viewerId: 'j', solicitanteId: 'a', esJefeDirecto: true, esRrhh: false })).toBe(true);
    expect(puedeResolver({ viewerId: 'r', solicitanteId: 'a', esJefeDirecto: false, esRrhh: true })).toBe(true);
    expect(puedeResolver({ viewerId: 'x', solicitanteId: 'a', esJefeDirecto: false, esRrhh: false })).toBe(false);
    expect(puedeResolver({ viewerId: 'a', solicitanteId: 'a', esJefeDirecto: false, esRrhh: true })).toBe(false);
  });
});

describe('transicion', () => {
  const base = { estado: 'pendiente' as const, tipo: 'PERMISO', empezo: false, tieneAusencia: true, esDueno: false, esRrhh: false };
  it('aprobar vacaciones pendientes crea la ausencia; un permiso ya la tiene', () => {
    expect(transicion({ ...base, accion: 'aprobar', tipo: 'VACACIONES', tieneAusencia: false })).toEqual({ ok: true, nuevo: 'aprobada', efecto: 'crear' });
    expect(transicion({ ...base, accion: 'aprobar' })).toEqual({ ok: true, nuevo: 'aprobada', efecto: 'ninguno' });
  });
  it('no se responde dos veces', () => {
    expect(transicion({ ...base, estado: 'aprobada', accion: 'rechazar', motivo: 'no corresponde' }).ok).toBe(false);
  });
  it('rechazar pide motivo; quita la ausencia si no empezó, la deja si ya ocurrió', () => {
    expect(transicion({ ...base, accion: 'rechazar', motivo: 'no' }).ok).toBe(false);
    expect(transicion({ ...base, accion: 'rechazar', motivo: 'no hay cobertura ese día' })).toEqual({ ok: true, nuevo: 'rechazada', efecto: 'quitar' });
    expect(transicion({ ...base, accion: 'rechazar', empezo: true, motivo: 'no avisó con tiempo' })).toEqual({ ok: true, nuevo: 'rechazada', efecto: 'ninguno' });
  });
  it('la persona cancela la suya solo antes de que empiece', () => {
    expect(transicion({ ...base, accion: 'cancelar', esDueno: true })).toEqual({ ok: true, nuevo: 'cancelada', efecto: 'quitar' });
    expect(transicion({ ...base, accion: 'cancelar', esDueno: true, empezo: true }).ok).toBe(false);
    expect(transicion({ ...base, accion: 'cancelar', esDueno: false }).ok).toBe(false);
  });
  it('cancela también aprobadas futuras; vacaciones pendientes no tienen ausencia que quitar', () => {
    expect(transicion({ ...base, estado: 'aprobada', accion: 'cancelar', esDueno: true })).toEqual({ ok: true, nuevo: 'cancelada', efecto: 'quitar' });
    expect(transicion({ ...base, tipo: 'VACACIONES', tieneAusencia: false, accion: 'cancelar', esDueno: true })).toEqual({ ok: true, nuevo: 'cancelada', efecto: 'ninguno' });
  });
  it('RRHH anula una ya empezada solo con motivo', () => {
    expect(transicion({ ...base, accion: 'cancelar', esRrhh: true, empezo: true }).ok).toBe(false);
    expect(transicion({ ...base, accion: 'cancelar', esRrhh: true, empezo: true, motivo: 'cargada por error' })).toEqual({ ok: true, nuevo: 'cancelada', efecto: 'quitar' });
  });
  it('rechazada o cancelada no se cancela', () => {
    expect(transicion({ ...base, estado: 'cancelada', accion: 'cancelar', esDueno: true }).ok).toBe(false);
  });
});

describe('textoRango', () => {
  const TZ = 'America/Costa_Rica';
  it('permiso: día y horas en hora de Costa Rica', () => {
    expect(textoRango('PERMISO', '2026-10-20T15:00:00.000Z', '2026-10-20T16:00:00.000Z', TZ)).toBe('el 20 oct de 09:00 a 10:00');
  });
  it('vacaciones de varios días y de uno solo', () => {
    expect(textoRango('VACACIONES', '2026-10-26T06:00:00.000Z', '2026-10-31T05:59:59.999Z', TZ)).toBe('del 26 al 30 oct');
    expect(textoRango('VACACIONES', '2026-10-08T06:00:00.000Z', '2026-10-09T05:59:59.999Z', TZ)).toBe('el 8 oct');
  });
});
