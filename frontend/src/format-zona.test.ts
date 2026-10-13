import { describe, it, expect, afterEach, vi } from 'vitest';
import { absenceReturnDate, absenceLastDay, textoVuelta } from './format';

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

describe('textoVuelta — el «Vuelve…» de la tarjeta', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('unas vacaciones vuelven al día siguiente del último', () => {
    expect(textoVuelta(FIN)).toBe('Vuelve el 9 de octubre');
  });

  it('un permiso de hoy vuelve a una hora, no mañana', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T16:00:00Z')); // 10:00 en Costa Rica
    expect(textoVuelta('2026-10-08T16:30:00.000Z')).toBe('Vuelve a las 10:30');
  });

  it('una cita de otro día dice el día y la hora', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T16:00:00Z'));
    expect(textoVuelta('2026-10-09T21:30:00.000Z')).toBe('Vuelve el 9 de octubre a las 15:30');
  });
});
