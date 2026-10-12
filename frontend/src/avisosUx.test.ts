import { describe, it, expect } from 'vitest';
import { haceCuanto, estadoNavegador, claveABytes } from './avisosUx';

const AHORA = Date.parse('2026-10-12T18:00:00Z');
const antes = (min: number) => new Date(AHORA - min * 60_000).toISOString();

describe('haceCuanto', () => {
  it('minutos, horas, ayer y días', () => {
    expect(haceCuanto(antes(0), AHORA)).toBe('ahora');
    expect(haceCuanto(antes(5), AHORA)).toBe('hace 5 min');
    expect(haceCuanto(antes(180), AHORA)).toBe('hace 3 h');
    expect(haceCuanto(antes(26 * 60), AHORA)).toBe('ayer');
    expect(haceCuanto(antes(4 * 24 * 60), AHORA)).toBe('hace 4 días');
  });
  it('más de una semana: la fecha', () => {
    expect(haceCuanto('2026-09-20T18:00:00Z', AHORA)).toMatch(/20 sept?/);
  });
});

describe('estadoNavegador', () => {
  it('activo solo con permiso y suscripción', () => {
    expect(estadoNavegador({ soportado: true, permiso: 'granted', suscrito: true })).toBe('activo');
    expect(estadoNavegador({ soportado: true, permiso: 'granted', suscrito: false })).toBe('inactivo');
    expect(estadoNavegador({ soportado: true, permiso: 'default', suscrito: false })).toBe('inactivo');
  });
  it('bloqueado si la persona lo negó; no disponible sin soporte', () => {
    expect(estadoNavegador({ soportado: true, permiso: 'denied', suscrito: false })).toBe('bloqueado');
    expect(estadoNavegador({ soportado: false, permiso: 'default', suscrito: false })).toBe('no-disponible');
    expect(estadoNavegador({ soportado: true, permiso: null, suscrito: false })).toBe('no-disponible');
  });
});

describe('claveABytes', () => {
  it('decodifica base64url sin relleno', () => {
    expect(Array.from(claveABytes('AQID_-8'))).toEqual([1, 2, 3, 255, 239]);
  });
});
