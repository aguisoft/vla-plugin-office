import { describe, it, expect } from 'vitest';
import { horarioInicial, yaPaso, sugerirTarde, hoyLocal } from './permisoHorario';

// Hora local de la máquina: se arma con el constructor local para no depender de la zona.
const a = (h: number, m: number) => new Date(2026, 9, 6, h, m);
const HOY = '2026-10-06';

describe('horarioInicial', () => {
  it('hoy, desde ahora redondeado a 5 min, una hora de largo', () => {
    expect(horarioInicial(a(17, 33))).toEqual({ fecha: HOY, desde: '17:35', hasta: '18:35' });
    expect(horarioInicial(a(9, 0))).toEqual({ fecha: HOY, desde: '09:00', hasta: '10:00' });
  });
  it('cerca de medianoche no se pasa del día', () => {
    expect(horarioInicial(a(23, 40))).toEqual({ fecha: HOY, desde: '23:40', hasta: '23:59' });
    expect(horarioInicial(a(23, 58))).toEqual({ fecha: HOY, desde: '23:55', hasta: '23:59' });
  });
});

describe('yaPaso', () => {
  it('el caso de Milady: a las 17:35, un permiso hasta 06:30 de hoy ya pasó', () => {
    expect(yaPaso(HOY, '06:30', a(17, 35))).toBe(true);
  });
  it('uno que termina más tarde, o de mañana, no', () => {
    expect(yaPaso(HOY, '18:30', a(17, 35))).toBe(false);
    expect(yaPaso('2026-10-07', '06:30', a(17, 35))).toBe(false);
  });
  it('un día anterior sí; sin fecha no se opina', () => {
    expect(yaPaso('2026-10-05', '18:00', a(9, 0))).toBe(true);
    expect(yaPaso('', '06:30', a(17, 35))).toBe(false);
  });
});

describe('sugerirTarde', () => {
  it('el caso de Milady: sugiere 17:35–18:30', () => {
    expect(sugerirTarde(HOY, '05:35', '06:30', a(17, 35))).toEqual({ desde: '17:35', hasta: '18:30' });
  });
  it('si la tarde también ya pasó, o era de la tarde, no sugiere', () => {
    expect(sugerirTarde(HOY, '01:00', '02:00', a(17, 35))).toBeNull();
    expect(sugerirTarde(HOY, '13:00', '14:00', a(17, 35))).toBeNull();
  });
  it('si no pasó, no hay nada que sugerir', () => {
    expect(sugerirTarde(HOY, '17:35', '18:30', a(17, 35))).toBeNull();
  });
  it('hoyLocal arma la fecha local', () => expect(hoyLocal(a(0, 5))).toBe(HOY));
});

