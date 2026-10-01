import { describe, it, expect } from 'vitest';
import { compararVentana } from './absence-window';

const s = (...ids: string[]) => new Set(ids);

/**
 * Estas pruebas vienen de un caso real: una colaboradora registró un permiso
 * de 10:00 a 10:20 a las 09:57 y reportó que «su estado no cambió». El dato
 * estaba bien —el backend la resolvía como PERMISO desde las 10:00— pero nadie
 * se lo había contado a su navegador: el único evento se había emitido al
 * crearla, a las 09:57, cuando todavía decía «Disponible» con razón.
 */

describe('compararVentana', () => {
  it('detecta a quien acaba de entrar en ausencia', () => {
    expect(compararVentana(s('ana'), s('ana', 'beto')))
      .toEqual({ entraron: ['beto'], salieron: [] });
  });

  it('detecta a quien acaba de salir', () => {
    expect(compararVentana(s('ana', 'beto'), s('ana')))
      .toEqual({ entraron: [], salieron: ['beto'] });
  });

  it('detecta las dos cosas en el mismo minuto', () => {
    const r = compararVentana(s('ana'), s('beto'))!;
    expect(r.entraron).toEqual(['beto']);
    expect(r.salieron).toEqual(['ana']);
  });

  it('sin cambios no anuncia nada', () => {
    expect(compararVentana(s('ana', 'beto'), s('beto', 'ana'))).toBeNull();
  });

  it('dos conjuntos vacíos tampoco anuncian', () => {
    expect(compararVentana(s(), s())).toBeNull();
  });

  /**
   * El caso que justifica el parámetro nulo. Sin él, cada reinicio del API
   * anunciaría como recién ausentes a todos los que ya lo estaban, y cada
   * pantalla abierta recargaría sin motivo.
   */
  it('el primer tick fija la línea base y NO anuncia, aunque ya haya ausentes', () => {
    expect(compararVentana(null, s('ana', 'beto', 'caro'))).toBeNull();
  });

  it('el primer tick sin ausentes tampoco anuncia', () => {
    expect(compararVentana(null, s())).toBeNull();
  });

  it('pasar de nadie a alguien sí anuncia, una vez fijada la base', () => {
    expect(compararVentana(s(), s('ana')))
      .toEqual({ entraron: ['ana'], salieron: [] });
  });

  it('pasar de alguien a nadie también', () => {
    expect(compararVentana(s('ana'), s()))
      .toEqual({ entraron: [], salieron: ['ana'] });
  });

  it('no modifica los conjuntos que recibe', () => {
    const previos = s('ana');
    const ahora = s('beto');
    compararVentana(previos, ahora);
    expect([...previos]).toEqual(['ana']);
    expect([...ahora]).toEqual(['beto']);
  });

  it('varias personas a la vez, como un feriado que entra a medianoche', () => {
    const r = compararVentana(s(), s('ana', 'beto', 'caro', 'dani'))!;
    expect(r.entraron.sort()).toEqual(['ana', 'beto', 'caro', 'dani']);
    expect(r.salieron).toEqual([]);
  });
});
