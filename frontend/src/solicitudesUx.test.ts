import { describe, it, expect } from 'vitest';
import { etiquetaSolicitud, cancelable, vigenteEnHistorial, pantallaInicial } from './solicitudesUx';

const ahora = Date.parse('2026-10-12T15:00:00Z');
const s = (o: object) => ({ estado: 'pendiente', tipo: 'PERMISO', startAt: '2026-10-20T15:00:00Z', endAt: '2026-10-20T16:00:00Z', ...o }) as any;

describe('etiquetaSolicitud', () => {
  it('un permiso pendiente ya está aplicado; unas vacaciones pendientes esperan', () => {
    expect(etiquetaSolicitud(s({}), ahora).texto).toBe('Aplicada · falta aprobación');
    expect(etiquetaSolicitud(s({ tipo: 'VACACIONES' }), ahora).texto).toBe('Esperando a tu jefe');
  });
  it('aprobada futura, en curso o terminada; rechazada y cancelada', () => {
    expect(etiquetaSolicitud(s({ estado: 'aprobada' }), ahora).texto).toBe('Aprobada');
    expect(etiquetaSolicitud(s({ estado: 'aprobada', startAt: '2026-10-12T14:00:00Z', endAt: '2026-10-12T18:00:00Z' }), ahora).texto).toBe('Aprobada · en curso');
    expect(etiquetaSolicitud(s({ estado: 'aprobada', startAt: '2026-10-01T14:00:00Z', endAt: '2026-10-01T15:00:00Z' }), ahora).texto).toBe('Aprobada · terminada');
    expect(etiquetaSolicitud(s({ estado: 'rechazada' }), ahora).texto).toBe('No aprobada');
    expect(etiquetaSolicitud(s({ estado: 'cancelada' }), ahora).texto).toBe('Cancelada');
  });
});

describe('cancelable y vigenteEnHistorial', () => {
  it('se cancela antes de empezar, pendiente o aprobada', () => {
    expect(cancelable(s({}), ahora)).toBe(true);
    expect(cancelable(s({ estado: 'aprobada' }), ahora)).toBe(true);
    expect(cancelable(s({ startAt: '2026-10-12T14:00:00Z' }), ahora)).toBe(false);
    expect(cancelable(s({ estado: 'rechazada' }), ahora)).toBe(false);
  });
  it('lo resuelto de hace más de un mes se oculta; lo pendiente no', () => {
    expect(vigenteEnHistorial(s({ estado: 'aprobada', endAt: '2026-09-01T00:00:00Z' }), ahora)).toBe(false);
    expect(vigenteEnHistorial(s({ estado: 'aprobada', endAt: '2026-09-20T00:00:00Z' }), ahora)).toBe(true);
    expect(vigenteEnHistorial(s({ estado: 'pendiente', endAt: '2026-08-01T00:00:00Z' }), ahora)).toBe(true);
  });
});

describe('pantallaInicial', () => {
  it('lee el parámetro del iframe o de la página que lo contiene', () => {
    expect(pantallaInicial('?solicitudes=1')).toBe('solicitudes');
    expect(pantallaInicial('', '?x=2&feriado=1')).toBe('feriado');
    expect(pantallaInicial(null, '?ausencias=1')).toBe('ausencias');
  });
  it('sin parámetro (o con otro valor) no abre nada', () => {
    expect(pantallaInicial('?solicitudes=0', '?escritorio=bitrix')).toBeNull();
    expect(pantallaInicial()).toBeNull();
  });
});
