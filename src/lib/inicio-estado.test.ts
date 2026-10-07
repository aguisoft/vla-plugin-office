import { describe, it, expect } from 'vitest';
import { inicioDelEstado } from './inicio-estado';

const ahora = new Date('2026-10-07T17:11:59Z');

describe('inicioDelEstado', () => {
  it('vuelvo pronto o almuerzo sin inicio (desde la app): empieza ahora', () => {
    expect(inicioDelEstado('BRB', null, ahora)).toEqual(ahora);
    expect(inicioDelEstado('LUNCH', undefined, ahora)).toEqual(ahora);
  });
  it('si viene inicio, se respeta', () => {
    const d = new Date('2026-10-07T17:00:00Z');
    expect(inicioDelEstado('BRB', d, ahora)).toBe(d);
  });
  it('los estados sin cronómetro siguen sin inicio', () => {
    expect(inicioDelEstado('AVAILABLE', null, ahora)).toBeNull();
    expect(inicioDelEstado('FOCUS', null, ahora)).toBeNull();
  });
});
