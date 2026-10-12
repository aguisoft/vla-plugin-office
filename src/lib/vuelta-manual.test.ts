import { describe, it, expect } from 'vitest';
import { avisoDeVuelta, quedaVolviendo, JUSTIFICACION_VUELTA } from './vuelta-manual';

const hora = (d: Date) => d.toISOString().slice(11, 16);
const T = new Date('2026-10-12T19:00:00Z');

describe('avisoDeVuelta', () => {
  it('el almuerzo sigue contando hasta que la persona marque Disponible', () => {
    expect(avisoDeVuelta('LUNCH', T, hora)).toEqual({
      titulo: 'Tu almuerzo terminó',
      cuerpo: 'Terminaba a las 19:00. Marcá Disponible cuando vuelvas: hasta entonces sigue contando como almuerzo.',
    });
  });
  it('vuelvo pronto, concentrado, permiso y cita dicen dónde quedan', () => {
    expect(avisoDeVuelta('BRB', T, hora).cuerpo).toContain('seguís en «Vuelvo pronto»');
    expect(avisoDeVuelta('FOCUS', T, hora).titulo).toBe('Tu tiempo de concentración terminó');
    expect(avisoDeVuelta('PERMISO', T, hora).cuerpo).toContain('quedás en «Vuelvo pronto»');
    expect(avisoDeVuelta('CITA_MEDICA', T, hora).titulo).toBe('Tu cita médica terminó');
  });
});

describe('quedaVolviendo', () => {
  const base = { tipoAusencia: 'PERMISO', isCheckedIn: true, status: 'AVAILABLE' };
  it('al terminar un permiso o una cita, quien estaba para atender queda volviendo', () => {
    expect(quedaVolviendo(base)).toBe(true);
    expect(quedaVolviendo({ ...base, tipoAusencia: 'CITA_MEDICA', status: 'FOCUS' })).toBe(true);
  });
  it('vacaciones e incapacidad no; fuera de la oficina no; otro estado elegido se respeta', () => {
    expect(quedaVolviendo({ ...base, tipoAusencia: 'VACACIONES' })).toBe(false);
    expect(quedaVolviendo({ ...base, isCheckedIn: false })).toBe(false);
    expect(quedaVolviendo({ ...base, status: 'LUNCH' })).toBe(false);
  });
  it('cada ausencia con vuelta tiene su texto', () => {
    expect(Object.keys(JUSTIFICACION_VUELTA).sort()).toEqual(['CITA_MEDICA', 'PERMISO']);
  });
});
