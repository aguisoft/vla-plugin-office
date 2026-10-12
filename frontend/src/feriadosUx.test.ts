import { describe, it, expect } from 'vitest';
import { semanasDelMes, motivoNoElegible, feriadoVigente, solicitudVigente, haceDias } from './feriadosUx';

describe('semanasDelMes', () => {
  it('octubre 2026 empieza jueves: 3 celdas vacías antes del 1, semanas de 7', () => {
    const s = semanasDelMes('2026-10-12');
    expect(s[0].slice(0, 4)).toEqual([null, null, null, { fecha: '2026-10-01', dia: 1 }]);
    expect(s.every(w => w.length === 7)).toBe(true);
    expect(s.flat().filter(Boolean)).toHaveLength(31);
  });
});

describe('motivoNoElegible', () => {
  const c = { hoy: '2026-10-09', feriado: '2026-10-12', otrosFeriados: ['2026-10-21'] };
  it.each([
    ['2026-10-12', 'Es el día del feriado'],
    ['2026-10-05', 'Ya pasó'],
    ['2026-10-09', 'Ya pasó'],
    ['2026-10-17', 'Fin de semana'],
    ['2026-10-21', 'Ya es feriado'],
    ['2026-10-20', null],
  ])('%s → %s', (f, m) => expect(motivoNoElegible(f, c)).toBe(m));
});

describe('qué se oculta', () => {
  const hoy = '2026-10-12';
  it('un feriado de hace más de un mes no; uno de hace dos semanas sí se ve', () => {
    expect(haceDias(hoy, 31)).toBe('2026-09-11');
    expect(feriadoVigente('2026-09-10', hoy)).toBe(false);
    expect(feriadoVigente('2026-09-28', hoy)).toBe(true);
    expect(feriadoVigente('2026-12-25', hoy)).toBe(true);
  });
  it('una solicitud pendiente siempre se ve; una resuelta de hace más de un mes no', () => {
    expect(solicitudVigente({ status: 'PENDING', holidayDate: '2026-08-01', newDate: '2026-08-10' }, hoy)).toBe(true);
    expect(solicitudVigente({ status: 'APPROVED', holidayDate: '2026-08-01', newDate: '2026-08-10' }, hoy)).toBe(false);
    expect(solicitudVigente({ status: 'REJECTED', holidayDate: '2026-09-15', newDate: '2026-09-29' }, hoy)).toBe(true);
  });
});
