import { describe, it, expect } from 'vitest';
import { semaforo, reloj, LIMITE_MIN, COLCHON_AMBAR_MIN } from './timeLimits';

const T0 = new Date('2026-10-06T14:00:00Z');
const masMin = (n: number) => new Date(T0.getTime() + n * 60000);

describe('semaforo — los cuatro plazos pedidos', () => {
  it.each([
    ['BRB', 10], ['LUNCH', 60], ['PERMISO', 60], ['CITA_MEDICA', 180],
  ] as const)('%s vence a los %i minutos', (estado, limite) => {
    expect(LIMITE_MIN[estado]).toBe(limite);
    expect(semaforo(estado, T0, masMin(limite))!.fase).not.toBe('rojo');       // justo en el límite aún no es exceso
    expect(semaforo(estado, T0, masMin(limite + 1))!.fase).toBe('rojo');
  });

  it('verde mientras falte más que el colchón', () => {
    const s = semaforo('LUNCH', T0, masMin(30))!;
    expect(s.fase).toBe('verde');
    expect(s.excesoSeg).toBe(0);
  });

  it('ámbar en los últimos minutos antes del límite', () => {
    expect(semaforo('CITA_MEDICA', T0, masMin(180 - COLCHON_AMBAR_MIN))!.fase).toBe('ambar');
    expect(semaforo('CITA_MEDICA', T0, masMin(180 - COLCHON_AMBAR_MIN - 1))!.fase).toBe('verde');
  });

  it('pasado el límite el cronómetro SIGUE contando y mide el exceso', () => {
    const s = semaforo('BRB', T0, masMin(25))!;
    expect(s.fase).toBe('rojo');
    expect(s.transcurridoSeg).toBe(25 * 60);   // no se congela en el límite
    expect(s.excesoSeg).toBe(15 * 60);
  });

  it('los estados sin plazo no llevan cronómetro', () => {
    expect(semaforo('AVAILABLE', T0, masMin(300))).toBeNull();
    expect(semaforo('FOCUS', T0, masMin(300))).toBeNull();
    expect(semaforo('VACACIONES', T0, masMin(300))).toBeNull();
  });

  it('sin fecha de inicio no se inventa un cronómetro desde cero', () => {
    expect(semaforo('LUNCH', null)).toBeNull();
    expect(semaforo('LUNCH', undefined)).toBeNull();
    expect(semaforo('LUNCH', 'no es fecha')).toBeNull();
  });

  it('un inicio en el futuro muestra cero, no un negativo', () => {
    const s = semaforo('LUNCH', masMin(10), T0)!;
    expect(s.transcurridoSeg).toBe(0);
    expect(s.fase).toBe('verde');
  });
});

describe('reloj', () => {
  it('mm:ss hasta la hora y h:mm:ss después', () => {
    expect(reloj(0)).toBe('00:00');
    expect(reloj(65)).toBe('01:05');
    expect(reloj(3599)).toBe('59:59');
    expect(reloj(3600)).toBe('1:00:00');
    expect(reloj(3 * 3600 + 25 * 60 + 7)).toBe('3:25:07');
  });
  it('nunca muestra negativos', () => {
    expect(reloj(-30)).toBe('00:00');
  });
});
