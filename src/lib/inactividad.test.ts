import { describe, it, expect } from 'vitest';
import { motivoDeCierre, estadosVencidos, jornadaBitrix } from './inactividad';

// Viernes 2-oct-2026, 16:01 en Costa Rica.
const AHORA = new Date('2026-10-02T22:01:00Z');
const OCHO_AM = new Date('2026-10-02T14:00:00Z');

describe('motivoDeCierre', () => {
  // El caso real: entró a las 8:00, quedó en Disponible y tiene la app abierta.
  it('con la app o la oficina abiertas no se cierra a las 8 h', () => {
    expect(motivoDeCierre({ ahora: AHORA, lastActivityAt: OCHO_AM, ultimaConexion: null, conectado: true, checkInAt: OCHO_AM })).toBeNull();
  });

  it('conectado, pero con la entrada de hace más de 16 h (compu prendida toda la noche): se cierra', () => {
    const ayer = new Date(AHORA.getTime() - 17 * 3_600_000);
    expect(motivoDeCierre({ ahora: AHORA, lastActivityAt: ayer, ultimaConexion: null, conectado: true, checkInAt: ayer })).toBe('tope');
  });

  it('sin pantallas: cuenta desde la última vez que se lo vio, no desde el último cambio de estado', () => {
    const cerroA = new Date('2026-10-02T21:45:00Z'); // 15:45
    expect(motivoDeCierre({ ahora: AHORA, lastActivityAt: OCHO_AM, ultimaConexion: cerroA, conectado: false, checkInAt: OCHO_AM })).toBeNull();
    const madrugada = new Date(cerroA.getTime() + 8 * 3_600_000 + 60_000);
    expect(motivoDeCierre({ ahora: madrugada, lastActivityAt: OCHO_AM, ultimaConexion: cerroA, conectado: false, checkInAt: OCHO_AM })).toBe('inactivo');
  });

  it('sin pantallas y sin saber cuándo se lo vio: como antes, 8 h desde el último cambio', () => {
    expect(motivoDeCierre({ ahora: AHORA, lastActivityAt: OCHO_AM, ultimaConexion: null, conectado: false, checkInAt: OCHO_AM })).toBe('inactivo');
    expect(motivoDeCierre({ ahora: AHORA, lastActivityAt: new Date('2026-10-02T15:00:00Z'), ultimaConexion: null, conectado: false, checkInAt: OCHO_AM })).toBeNull();
  });

  it('con la jornada de Bitrix abierta no sale a las 8 h aunque no tenga la oficina abierta (caso Esteban, 6-oct 15:45)', () => {
    expect(motivoDeCierre({ ahora: AHORA, lastActivityAt: OCHO_AM, ultimaConexion: null, conectado: false, checkInAt: OCHO_AM, jornadaAbierta: true })).toBeNull();
    // Pero una jornada olvidada se cierra igual al tope de 16 h desde la entrada.
    const tarde = new Date(OCHO_AM.getTime() + 16 * 3_600_000 + 60_000);
    expect(motivoDeCierre({ ahora: tarde, lastActivityAt: OCHO_AM, ultimaConexion: null, conectado: false, checkInAt: OCHO_AM, jornadaAbierta: true })).toBe('tope');
  });

  it('sin ningún dato no se cierra', () => {
    expect(motivoDeCierre({ ahora: AHORA, lastActivityAt: null, ultimaConexion: null, conectado: false, checkInAt: null })).toBeNull();
  });
});

describe('estadosVencidos', () => {
  const fila = (x: object) => ({ userId: 'a', status: 'LUNCH', statusEndsAt: new Date('2026-10-02T19:00:00Z'), isCheckedIn: true, ...x });

  it('el almuerzo que terminó vence; el que no, no', () => {
    expect(estadosVencidos([fila({}), fila({ userId: 'b', statusEndsAt: new Date('2026-10-02T23:00:00Z') })], AHORA).map(f => f.userId)).toEqual(['a']);
  });

  it('sin fin, ya disponible, afuera o desconectado: no se toca', () => {
    expect(estadosVencidos([
      fila({ statusEndsAt: null }), fila({ status: 'AVAILABLE' }), fila({ isCheckedIn: false }), fila({ status: 'OFFLINE' }), fila({ status: 'IN_MEETING_INTERNAL' }),
    ], AHORA)).toEqual([]);
  });
});

describe('jornadaBitrix', () => {
  it('abierta, cerrada, vencida o sin dato', () => {
    expect(jornadaBitrix('OPENED')).toBe('abierta');
    expect(jornadaBitrix('PAUSED')).toBe('abierta');
    expect(jornadaBitrix('CLOSED')).toBe('cerrada');
    // La de un día anterior sin cerrar no mete ni saca a nadie (caso Sabrina).
    expect(jornadaBitrix('EXPIRED')).toBe('vencida');
    expect(jornadaBitrix(undefined)).toBeNull();
    expect(jornadaBitrix('OTRA')).toBeNull();
  });
});
