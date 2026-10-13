import { describe, it, expect } from 'vitest';
import { elegirDia, rangoDe, moverMes, limitesMes, nombreMes, fechaEnPalabras, esFinDeSemana, textoDias, diaSemana, lecturaSaldo } from './vacacionesUx';

describe('elegirDia', () => {
  it('el primer toque abre el rango y el segundo lo cierra', () => {
    const a = elegirDia({ desde: null, hasta: null }, '2026-10-26');
    expect(a).toEqual({ desde: '2026-10-26', hasta: null });
    expect(elegirDia(a, '2026-10-30')).toEqual({ desde: '2026-10-26', hasta: '2026-10-30' });
  });
  it('un día anterior al primero, o un toque con el rango cerrado, empieza de nuevo', () => {
    expect(elegirDia({ desde: '2026-10-26', hasta: null }, '2026-10-20')).toEqual({ desde: '2026-10-20', hasta: null });
    expect(elegirDia({ desde: '2026-10-26', hasta: '2026-10-30' }, '2026-11-02')).toEqual({ desde: '2026-11-02', hasta: null });
  });
  it('el mismo día dos veces es un solo día', () => {
    expect(elegirDia({ desde: '2026-10-08', hasta: null }, '2026-10-08')).toEqual({ desde: '2026-10-08', hasta: '2026-10-08' });
  });
});

describe('rangoDe', () => {
  it('con un solo día tocado, desde = hasta; sin nada, null', () => {
    expect(rangoDe({ desde: '2026-10-08', hasta: null })).toEqual({ desde: '2026-10-08', hasta: '2026-10-08' });
    expect(rangoDe({ desde: null, hasta: null })).toBeNull();
  });
});

describe('meses y fechas', () => {
  it('moverMes cruza el año', () => {
    expect(moverMes('2026-12', 1)).toBe('2027-01');
    expect(moverMes('2026-01', -1)).toBe('2025-12');
  });
  it('limitesMes conoce los febreros', () => {
    expect(limitesMes('2028-02')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' });
  });
  it('nombres en español sin correrse de día', () => {
    expect(nombreMes('2026-10')).toBe('Octubre 2026');
    expect(fechaEnPalabras('2026-10-09')).toMatch(/^viernes 9 oct/);
    expect(esFinDeSemana('2026-10-10')).toBe(true);
    expect(esFinDeSemana('2026-10-09')).toBe(false);
  });
  it('textoDias concuerda', () => {
    expect(textoDias(1)).toBe('1 día hábil');
    expect(textoDias(5)).toBe('5 días hábiles');
    expect(textoDias(6, 'corrido')).toBe('6 días corridos');
    expect(textoDias(0.5)).toBe('medio día hábil');
    expect(textoDias(5.5)).toBe('5,5 días hábiles');
    expect(diaSemana('2026-10-17')).toBe(6);
  });
});

describe('lecturaSaldo — el saldo al pedir vacaciones', () => {
  const s = { cargado: true as const, disponible: 3.5 };
  it('sin saldo cargado no bloquea, pero lo dice', () => {
    expect(lecturaSaldo({ cargado: false }, 10)).toEqual({ alcanza: true, texto: 'RRHH todavía no cargó tu saldo de vacaciones.' });
  });
  it('sin días elegidos, lo disponible', () => {
    expect(lecturaSaldo(s, null).texto).toBe('Tenés 3,5 días hábiles disponibles.');
  });
  it('alcanza justo, y lo que queda', () => {
    expect(lecturaSaldo(s, 3.5)).toEqual({ alcanza: true, texto: 'Después de este pedido te quedan 0 días hábiles.' });
    expect(lecturaSaldo(s, 3)).toEqual({ alcanza: true, texto: 'Después de este pedido te quedan medio día hábil.' });
  });
  it('no alcanza: se bloquea y se dice por qué', () => {
    expect(lecturaSaldo(s, 4)).toEqual({ alcanza: false, texto: 'No alcanza: tenés 3,5 días hábiles disponibles y este pedido usa 4 días hábiles.' });
  });
  it('para otra persona (RRHH)', () => {
    expect(lecturaSaldo(s, 4, false).texto).toBe('No alcanza: tiene 3,5 días hábiles disponibles y este pedido usa 4 días hábiles.');
  });
});
