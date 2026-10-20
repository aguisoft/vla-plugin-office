import { describe, it, expect } from 'vitest';
import { archivoSeguro, leerPublicacion, huboPublicacionNueva, plataformaDe, archivoPublicacion } from './publicacion-escritorio';

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

describe('una publicación por sistema', () => {
  const pub = (m: object) => JSON.stringify({ manifiesto: JSON.stringify(m), firma: 'f' });
  const base = { version: '0.10.0', sha512: 'x', tamano: 3, fecha: 'f' };

  it('cada sistema acepta solo su archivo', () => {
    expect(archivoSeguro('VLA-Oficina-0.10.0.AppImage', 'linux')).toBe(true);
    expect(archivoSeguro('VLA-Oficina-0.10.0.AppImage')).toBe(false);
    expect(archivoSeguro('VLA-Oficina-Setup-0.10.0.exe', 'linux')).toBe(false);
    expect(archivoSeguro('../VLA-Oficina-0.10.0.AppImage', 'linux')).toBe(false);
  });

  it('la de Linux tiene que decir que es de Linux, y no se puede leer como de Windows', () => {
    const linux = pub({ ...base, archivo: 'VLA-Oficina-0.10.0.AppImage', plataforma: 'linux' });
    expect(leerPublicacion(linux, 'linux')?.meta.plataforma).toBe('linux');
    expect(leerPublicacion(linux)).toBeNull();
    expect(leerPublicacion(pub({ ...base, archivo: 'VLA-Oficina-0.10.0.AppImage' }), 'linux')).toBeNull();
  });

  it('la de Windows sigue como siempre (sin plataforma) y no sirve para Linux', () => {
    const win = pub({ ...base, archivo: 'VLA-Oficina-Setup-0.10.0.exe' });
    expect(leerPublicacion(win)?.meta.version).toBe('0.10.0');
    expect(leerPublicacion(win, 'linux')).toBeNull();
  });

  it('lo que pide la app: linux o, si no, Windows', () => {
    expect(plataformaDe('linux')).toBe('linux');
    expect(plataformaDe(undefined)).toBe('win');
    expect(plataformaDe('mac')).toBe('win');
    expect(archivoPublicacion('linux')).toBe('publicacion-linux.json');
    expect(archivoPublicacion('win')).toBe('publicacion.json');
  });
});
