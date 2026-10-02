import { describe, it, expect } from 'vitest';
import { versionValida, compararVersiones, estadoDeUso, textoTamano, DIAS_VIGENTE } from './escritorio-uso';

const AHORA = new Date('2026-10-02T20:00:00Z');

describe('versiones', () => {
  it.each([['0.8.4', true], ['10.0.12', true], ['0.8', false], ['0.8.4-beta', false], ['', false], [null, false]])('%p válida: %p', (v, ok) => {
    expect(versionValida(v)).toBe(ok);
  });

  it.each([['0.8.4', '0.8.4', 0], ['0.8.4', '0.8.10', -1], ['0.10.0', '0.9.9', 1], ['1.0.0', '0.99.99', 1]])('%s vs %s → %d', (a, b, r) => {
    expect(compararVersiones(a, b)).toBe(r);
  });
});

describe('estadoDeUso', () => {
  it('sin latido nunca: no la tiene', () => {
    expect(estadoDeUso(null, '0.8.5', AHORA)).toEqual({ instalada: false, version: null, ultimaVez: null, alDia: false });
  });

  it('latido de hoy con la última versión: instalada y al día', () => {
    expect(estadoDeUso({ version: '0.8.5', ultima_vez: '2026-10-02T19:00:00Z' }, '0.8.5', AHORA))
      .toEqual({ instalada: true, version: '0.8.5', ultimaVez: '2026-10-02T19:00:00.000Z', alDia: true });
  });

  it('con una versión vieja: instalada pero no al día', () => {
    expect(estadoDeUso({ version: '0.8.1', ultima_vez: AHORA }, '0.8.5', AHORA)).toMatchObject({ instalada: true, alDia: false });
  });

  it(`sin latido en más de ${DIAS_VIGENTE} días: ya no se cuenta como instalada`, () => {
    const vieja = new Date(AHORA.getTime() - (DIAS_VIGENTE + 1) * 86_400_000);
    expect(estadoDeUso({ version: '0.8.5', ultima_vez: vieja }, '0.8.5', AHORA).instalada).toBe(false);
  });

  it('sin nada publicado, la que tenga está al día', () => {
    expect(estadoDeUso({ version: '0.1.0', ultima_vez: AHORA }, null, AHORA).alDia).toBe(true);
  });
});

describe('textoTamano', () => {
  it.each([[112_349_042, '107 MB'], [5 * 1024 * 1024, '5.0 MB'], [0, '']])('%d → %s', (b, t) => expect(textoTamano(b)).toBe(t));
});
