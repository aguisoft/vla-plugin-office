import { describe, it, expect } from 'vitest';
import { valeMientrasPendiente, estadoInicial, puedeResolver, transicion, textoRango, fraseResolucion, fichaSolicitud, fechaLarga } from './solicitudes';

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

describe('fraseResolucion', () => {
  it('concuerda con el tipo: «Tus vacaciones … fueron aprobadas», «Tu permiso … fue aprobado»', () => {
    expect(fraseResolucion('VACACIONES', 'el 23 oct', 'aprobada', 'Josué Rodríguez'))
      .toBe('Tus vacaciones del 23 oct fueron aprobadas por Josué Rodríguez');
    expect(fraseResolucion('VACACIONES', 'del 26 al 30 oct', 'rechazada', 'Josué', 'cierre de mes'))
      .toBe('Tus vacaciones del 26 al 30 oct no fueron aprobadas por Josué: «cierre de mes»');
    expect(fraseResolucion('PERMISO', 'el 20 oct de 09:00 a 10:00', 'aprobada', 'Laura'))
      .toBe('Tu permiso el 20 oct de 09:00 a 10:00 fue aprobado por Laura');
    expect(fraseResolucion('CITA_MEDICA', 'el 20 oct de 09:00 a 10:00', 'cancelada', 'RRHH'))
      .toBe('Tu cita médica el 20 oct de 09:00 a 10:00 fue cancelada por RRHH');
    expect(fraseResolucion('INCAPACIDAD', 'el 5 oct', 'aprobada', 'Laura')).toBe('Tu incapacidad del 5 oct fue aprobada por Laura');
  });
});

describe('fichaSolicitud', () => {
  const TZ = 'America/Costa_Rica';
  it('vacaciones: los campos del formulario de papel, más quién la resolvió', () => {
    const f = fichaSolicitud({
      nombre: 'Ana Mora', tipo: 'VACACIONES', startIso: '2026-10-08T06:00:00Z', endIso: '2026-10-09T05:59:59Z', tz: TZ,
      diasHabiles: 1, reintegro: '2026-10-09', comentarios: '  Trámite personal ', estado: 'aprobada', resolvio: 'Josué Rodríguez',
    });
    expect(f).toEqual([
      ['Colaborador', 'Ana Mora'], ['Tipo', 'Vacaciones'],
      ['Desde', fechaLarga('2026-10-08T06:00:00Z', TZ)], ['Hasta', fechaLarga('2026-10-09T05:59:59Z', TZ)],
      ['Total', '1 día hábil'], ['Se reintegra', fechaLarga('2026-10-09', TZ)],
      ['Comentarios', 'Trámite personal'], ['Estado', 'Aprobada'], ['Resuelta por', 'Josué Rodríguez'],
    ]);
  });
  it('permiso: fecha y horario; pendiente no lleva estado', () => {
    const f = fichaSolicitud({ nombre: 'Ana', tipo: 'PERMISO', startIso: '2026-10-20T15:00:00Z', endIso: '2026-10-20T16:00:00Z', tz: TZ, estado: 'pendiente' });
    expect(f.map(x => x[0])).toEqual(['Colaborador', 'Tipo', 'Fecha', 'Horario']);
    expect(f[3][1]).toBe('09:00 a 10:00');
  });
  it('fechaLarga: día de la semana, día, mes y año, en la zona de la oficina', () => {
    expect(fechaLarga('2026-10-09', TZ)).toMatch(/^viernes 9 oct\w* 2026$/);
    expect(fechaLarga('2026-10-08T06:00:00Z', TZ)).toMatch(/^jueves 8 oct/);
  });
});
