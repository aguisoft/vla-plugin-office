import { describe, it, expect } from 'vitest';
import {
  resumenMensual, excederiaTope,
  TOPE_PERMISO_MES_MIN, TOPE_CITA_MEDICA_MIN,
} from './absence-usage';

const TZ = 'America/Costa_Rica';
const permiso = (ini: string, fin: string) => ({ type: 'PERMISO' as const, startAt: ini, endAt: fin });
const cita = (ini: string, fin: string) => ({ type: 'CITA_MEDICA' as const, startAt: ini, endAt: fin });

describe('resumenMensual — permiso largo (tope mensual acumulable)', () => {
  it('suma los permisos del mes: la hora se puede partir en 30 + 30', () => {
    const r = resumenMensual([
      permiso('2026-10-05T15:00:00Z', '2026-10-05T15:30:00Z'),
      permiso('2026-10-20T16:00:00Z', '2026-10-20T16:30:00Z'),
    ], 2026, 10, TZ);
    expect(r.permisoMin).toBe(60);
    expect(r.permisoRestanteMin).toBe(0);
    expect(r.permisoExcedido).toBe(false);   // 60 es el tope, no un exceso
  });

  it('marca excedido solo al pasarse, no al llegar justo', () => {
    const justo = resumenMensual([permiso('2026-10-05T15:00:00Z', '2026-10-05T16:00:00Z')], 2026, 10, TZ);
    expect(justo.permisoExcedido).toBe(false);
    const pasado = resumenMensual([permiso('2026-10-05T15:00:00Z', '2026-10-05T16:01:00Z')], 2026, 10, TZ);
    expect(pasado.permisoExcedido).toBe(true);
    expect(pasado.permisoRestanteMin).toBe(0);  // nunca negativo
  });

  it('el tope se reinicia cada mes', () => {
    const ausencias = [
      permiso('2026-09-28T15:00:00Z', '2026-09-28T16:00:00Z'),
      permiso('2026-10-02T15:00:00Z', '2026-10-02T15:20:00Z'),
    ];
    expect(resumenMensual(ausencias, 2026, 9, TZ).permisoMin).toBe(60);
    expect(resumenMensual(ausencias, 2026, 10, TZ).permisoMin).toBe(20);
  });

  // El bug que este proyecto ya tuvo dos veces: contar el día en UTC.
  it('un permiso de la tarde del último día del mes cuenta en SU mes local', () => {
    // 31/10 19:00 en Costa Rica = 01/11 01:00 UTC
    const a = [permiso('2026-11-01T01:00:00Z', '2026-11-01T01:30:00Z')];
    expect(resumenMensual(a, 2026, 10, TZ).permisoMin).toBe(30);
    expect(resumenMensual(a, 2026, 11, TZ).permisoMin).toBe(0);
  });

  it('un registro con fin anterior al inicio aporta 0, no resta saldo', () => {
    const r = resumenMensual([
      permiso('2026-10-05T16:00:00Z', '2026-10-05T15:00:00Z'),
      permiso('2026-10-06T15:00:00Z', '2026-10-06T15:40:00Z'),
    ], 2026, 10, TZ);
    expect(r.permisoMin).toBe(40);
  });

  it('vacaciones e incapacidad no consumen minutos', () => {
    const r = resumenMensual([
      { type: 'VACACIONES', startAt: '2026-10-05T06:00:00Z', endAt: '2026-10-09T05:59:59Z' },
      { type: 'INCAPACIDAD', startAt: '2026-10-12T06:00:00Z', endAt: '2026-10-13T05:59:59Z' },
    ], 2026, 10, TZ);
    expect(r.permisoMin).toBe(0);
    expect(r.citasMin).toBe(0);
  });
});

describe('resumenMensual — cita médica (tope por cita, no mensual)', () => {
  it('dos citas dentro de las 3 h no generan exceso aunque sumen más', () => {
    const r = resumenMensual([
      cita('2026-10-05T14:00:00Z', '2026-10-05T17:00:00Z'),   // 180
      cita('2026-10-19T14:00:00Z', '2026-10-19T16:00:00Z'),   // 120
    ], 2026, 10, TZ);
    expect(r.citasMin).toBe(300);
    expect(r.citasExcesoMin).toBe(0);
    expect(r.citas).toHaveLength(2);
  });

  it('el exceso se mide por cita y se acumula', () => {
    const r = resumenMensual([
      cita('2026-10-05T14:00:00Z', '2026-10-05T17:30:00Z'),   // 210 -> 30 de exceso
      cita('2026-10-19T14:00:00Z', '2026-10-19T17:15:00Z'),   // 195 -> 15 de exceso
    ], 2026, 10, TZ);
    expect(r.citasExcesoMin).toBe(45);
    expect(r.citas[0].excesoMin).toBe(30);
    expect(r.citas[1].excesoMin).toBe(15);
  });

  it('las citas salen ordenadas por fecha, no por orden de carga', () => {
    const r = resumenMensual([
      cita('2026-10-19T14:00:00Z', '2026-10-19T15:00:00Z'),
      cita('2026-10-05T14:00:00Z', '2026-10-05T15:00:00Z'),
    ], 2026, 10, TZ);
    expect(r.citas.map(c => c.inicio.slice(0, 10))).toEqual(['2026-10-05', '2026-10-19']);
  });

  it('justo en el tope no es exceso', () => {
    const r = resumenMensual([cita('2026-10-05T14:00:00Z', '2026-10-05T17:00:00Z')], 2026, 10, TZ);
    expect(r.citas[0].minutos).toBe(TOPE_CITA_MEDICA_MIN);
    expect(r.citas[0].excesoMin).toBe(0);
  });
});

describe('excederiaTope — el aviso previo del formulario', () => {
  it('avisa cuando el permiso nuevo pasa la hora del mes', () => {
    expect(excederiaTope(55, 10)).toBe(true);
    expect(excederiaTope(30, 30)).toBe(false);   // deja llegar justo al tope
    expect(excederiaTope(0, TOPE_PERMISO_MES_MIN)).toBe(false);
    expect(excederiaTope(TOPE_PERMISO_MES_MIN, 1)).toBe(true);
  });
});
