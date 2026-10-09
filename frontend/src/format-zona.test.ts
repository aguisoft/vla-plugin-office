import { describe, it, expect, afterEach } from 'vitest';
import { absenceReturnDate, absenceLastDay } from './format';

// Vacaciones de Carlos: solo el 8-oct-2026; fin 23:59:59.999 de Costa Rica.
const FIN = '2026-10-09T05:59:59.999Z';
const zonaOriginal = process.env.TZ;
afterEach(() => { process.env.TZ = zonaOriginal; });

const vuelta = () => absenceReturnDate(FIN).toLocaleDateString('es', { day: 'numeric', month: 'long' });

describe('fechas de una ausencia, sin importar la zona del navegador', () => {
  it.each(['America/Costa_Rica', 'America/Bogota', 'America/Managua', 'Europe/Madrid'])('desde %s: vuelve el 9 de octubre', (zona) => {
    process.env.TZ = zona;
    expect(vuelta()).toBe('9 de octubre');
    expect(absenceLastDay(FIN)).toMatch(/^8 oct/);
  });
});
