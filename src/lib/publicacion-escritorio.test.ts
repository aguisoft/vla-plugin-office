import { describe, it, expect } from 'vitest';
import { archivoSeguro, leerPublicacion, huboPublicacionNueva } from './publicacion-escritorio';

const manifiesto = JSON.stringify({
  version: '0.2.0', archivo: 'VLA-Oficina-Setup-0.2.0.exe', sha512: 'abc', tamano: 123, fecha: '2026-10-01T21:00:00Z',
});

describe('archivoSeguro', () => {
  it('acepta el nombre que genera electron-builder', () => expect(archivoSeguro('VLA-Oficina-Setup-0.2.0.exe')).toBe(true));
  it.each([['../../etc/passwd'], ['VLA-Oficina-Setup-0.2.0.exe/../x'], ['otro.exe'], ['VLA-Oficina-Setup-0.2.exe'], [42]])(
    'rechaza %p', (n) => expect(archivoSeguro(n)).toBe(false));
});

describe('leerPublicacion', () => {
  it('lee manifiesto y firma, conservando el texto exacto firmado', () => {
    const p = leerPublicacion(JSON.stringify({ manifiesto, firma: 'Zmlyb' }))!;
    expect(p.manifiesto).toBe(manifiesto);
    expect(p.firma).toBe('Zmlyb');
    expect(p.meta.version).toBe('0.2.0');
  });

  it.each([
    ['no es json'],
    [JSON.stringify({ firma: 'x' })],
    [JSON.stringify({ manifiesto: '{malo', firma: 'x' })],
    [JSON.stringify({ manifiesto: JSON.stringify({ version: '0.2', archivo: 'VLA-Oficina-Setup-0.2.0.exe', sha512: 'a', tamano: 1 }), firma: 'x' })],
    [JSON.stringify({ manifiesto: JSON.stringify({ version: '0.2.0', archivo: '../x.exe', sha512: 'a', tamano: 1 }), firma: 'x' })],
  ])('una publicación mal formada da null: %#', (t) => expect(leerPublicacion(t)).toBeNull());
});

describe('huboPublicacionNueva', () => {
  it('la primera lectura tras arrancar no avisa', () => expect(huboPublicacionNueva(undefined, '0.2.0')).toBe(false));
  it('una versión distinta avisa', () => expect(huboPublicacionNueva('0.2.0', '0.2.1')).toBe(true));
  it('la primera publicación de todas también avisa', () => expect(huboPublicacionNueva(null, '0.2.0')).toBe(true));
  it('la misma versión no', () => expect(huboPublicacionNueva('0.2.0', '0.2.0')).toBe(false));
  it('si la publicación desaparece, no avisa', () => expect(huboPublicacionNueva('0.2.0', null)).toBe(false));
});
