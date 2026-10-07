import { describe, it, expect } from 'vitest';
import { estadoDePlanta, fraseDePlanta, HORAS_SED, HORAS_MARCHITA, HORAS_SECA } from './planta';

const AHORA = new Date('2026-10-06T15:00:00Z');
const haceHoras = (h: number) => new Date(AHORA.getTime() - h * 3_600_000);

describe('estadoDePlanta — el estado sale del tiempo, no de un proceso', () => {
  it.each([
    [0, 'feliz'], [1, 'feliz'], [HORAS_SED - 0.1, 'feliz'],
    [HORAS_SED, 'sed'], [12, 'sed'], [HORAS_MARCHITA - 0.1, 'sed'],
    [HORAS_MARCHITA, 'marchita'], [36, 'marchita'], [HORAS_SECA - 0.1, 'marchita'],
    [HORAS_SECA, 'seca'], [100, 'seca'],
  ])('a las %i horas está %s', (h, esperado) => {
    expect(estadoDePlanta(haceHoras(h as number), AHORA).estado).toBe(esperado);
  });

  it('recién regada no se puede volver a regar: el gesto no se gasta', () => {
    expect(estadoDePlanta(haceHoras(1), AHORA).puedeRegar).toBe(false);
    expect(estadoDePlanta(haceHoras(HORAS_SED), AHORA).puedeRegar).toBe(true);
  });

  it('solo regarla seca cuenta como rescate', () => {
    expect(estadoDePlanta(haceHoras(30), AHORA).seriaRescate).toBe(false);
    expect(estadoDePlanta(haceHoras(50), AHORA).seriaRescate).toBe(true);
  });

  it('sin ningún riego arranca con sed, no seca', () => {
    const p = estadoDePlanta(null, AHORA);
    expect(p.estado).toBe('sed');
    expect(p.horasSinAgua).toBeNull();
    expect(p.puedeRegar).toBe(true);
  });

  it('una fecha futura o inválida no la rompe', () => {
    expect(estadoDePlanta(new Date(AHORA.getTime() + 3_600_000), AHORA).estado).toBe('feliz');
    expect(estadoDePlanta('no es fecha', AHORA).estado).toBe('sed');
  });

  it('cuenta las horas sin agua', () => {
    expect(estadoDePlanta(haceHoras(30), AHORA).horasSinAgua).toBe(30);
  });
});

describe('fraseDePlanta', () => {
  it('dice los días solo cuando está seca', () => {
    expect(fraseDePlanta(estadoDePlanta(haceHoras(2), AHORA))).toBe('Está contenta');
    expect(fraseDePlanta(estadoDePlanta(haceHoras(10), AHORA))).toBe('Tiene sed');
    expect(fraseDePlanta(estadoDePlanta(haceHoras(72), AHORA))).toBe('Hace 3 días que nadie la riega');
  });
  it('sin riegos lo dice sin inventar un número', () => {
    expect(fraseDePlanta({ estado: 'seca', horasSinAgua: null, puedeRegar: true, seriaRescate: true }))
      .toBe('Nadie la ha regado todavía');
  });
});
