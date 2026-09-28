import { describe, it, expect, vi, afterEach } from 'vitest';
import { hoyLocal } from './format';

/**
 * `hoyLocal` (M6): tiene que devolver el día en la zona de la OPERACIÓN
 * (Costa Rica, UTC−6), nunca la zona del navegador de quien consulta. Antes
 * usaba `d.getFullYear()/getMonth()/getDate()`, que lee la zona LOCAL del
 * proceso -- "hoy"/"ayer" se corría un día para quien abriera la pantalla
 * desde otro huso horario.
 *
 * Las pruebas fijan un instante UTC concreto con `vi.setSystemTime` y
 * comprueban el día que da la zona de Costa Rica -- sin importar la zona en
 * la que de verdad corra este runner (`Intl.DateTimeFormat` con `timeZone`
 * explícito no depende de ella).
 */
describe('hoyLocal', () => {
  afterEach(() => vi.useRealTimers());

  it('un instante de madrugada UTC que en Costa Rica todavía es el día ANTERIOR', () => {
    // 2026-09-25T04:00:00Z = 2026-09-24T22:00:00 en UTC-6 (Costa Rica):
    // todavía 24-sep allá, aunque en UTC ya sea 25-sep.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T04:00:00Z'));

    expect(hoyLocal()).toBe('2026-09-24');
  });

  it('un instante bien entrada la tarde UTC, donde el día coincide con el de Costa Rica', () => {
    // 2026-09-25T20:00:00Z = 2026-09-25T14:00:00 en UTC-6: mismo día en las
    // dos zonas, para no probar solo el caso que difiere.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T20:00:00Z'));

    expect(hoyLocal()).toBe('2026-09-25');
  });

  it('devuelve el formato YYYY-MM-DD, con ceros a la izquierda', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T20:00:00Z')); // 05-ene en Costa Rica

    expect(hoyLocal()).toBe('2026-01-05');
  });
});
