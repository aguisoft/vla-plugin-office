import { describe, it, expect } from 'vitest';
import {
  debeOfrecer, posponerHasta, leerPospuesto, textoCompaneros,
  normalizarCodigo, problemaDelCodigo, mensajeDeVinculacion, resultadoBitrix, textoEstadoBitrix, enlaceEscritorio,
} from './escritorio';

describe('normalizarCodigo', () => {
  it('pasa a mayúsculas y quita espacios y guiones', () => {
    expect(normalizarCodigo(' k7p-3qx ')).toBe('K7P3QX');
  });
});

describe('problemaDelCodigo', () => {
  it('un código bien escrito no tiene problema', () => {
    expect(problemaDelCodigo('K7P-3QX')).toBeNull();
  });

  it('vacío pide escribirlo', () => {
    expect(problemaDelCodigo('  ')).toMatch(/Escribí/);
  });

  it('largo incorrecto lo dice', () => {
    expect(problemaDelCodigo('K7P3')).toBe('El código tiene 6 caracteres.');
  });

  /** La confusión real al dictar o copiar: 0 por O, 1 por I o L. */
  it('un 0 u O explica que el código no los usa', () => {
    expect(problemaDelCodigo('K7P3Q0')).toMatch(/no usa 0 ni O/);
  });

  it('un 1, I o L explica que el código no los usa', () => {
    expect(problemaDelCodigo('K7P3QL')).toMatch(/no usa 1, I ni L/);
  });

  it('un símbolo dice que solo hay letras y números', () => {
    expect(problemaDelCodigo('K7P3Q!')).toBe('El código solo tiene letras y números.');
  });
});

describe('mensajeDeVinculacion', () => {
  it('404 dice que venció y qué hacer', () => {
    expect(mensajeDeVinculacion(404)).toMatch(/venció.*Pedí uno nuevo/);
  });

  it('403 muestra el motivo del core (p. ej. suplantación)', () => {
    expect(mensajeDeVinculacion(403, { message: 'No se puede vincular mientras suplantás a alguien' }))
      .toBe('No se puede vincular mientras suplantás a alguien');
  });

  it('401 pide recargar', () => {
    expect(mensajeDeVinculacion(401)).toMatch(/Recargá/);
  });

  it('cualquier otro, genérico', () => {
    expect(mensajeDeVinculacion(500)).toMatch(/Intentá de nuevo/);
  });
});

describe('resultadoBitrix', () => {
  it('lo encuentra en la URL del iframe', () => {
    expect(resultadoBitrix('?bitrix=listo', '')).toBe('listo');
  });

  it('o en la de la página que lo contiene', () => {
    expect(resultadoBitrix('', '?view=oficina&bitrix=error')).toBe('error');
  });

  it('ignora valores que no son nuestros', () => {
    expect(resultadoBitrix('?bitrix=connected', null)).toBeNull();
  });
});

describe('textoEstadoBitrix', () => {
  it('conectado con fecha', () => {
    expect(textoEstadoBitrix({ conectado: true, desde: '2026-10-01T18:00:00Z' })).toMatch(/^Conectado desde el 1 de octubre/);
  });

  it('rechazo por otra cuenta explica cómo resolverlo', () => {
    expect(textoEstadoBitrix({ conectado: false, rechazo: 'otra_cuenta' })).toMatch(/otra cuenta.*Cerrá esa sesión/);
  });

  it('sin conectar explica para qué sirve', () => {
    expect(textoEstadoBitrix({ conectado: false })).toMatch(/No conectado/);
  });
});

describe('enlaceEscritorio', () => {
  it('un código válido se precarga, normalizado', () => {
    expect(enlaceEscritorio('?escritorio=k7p-3qx')).toEqual({ tipo: 'codigo', codigo: 'K7P3QX' });
  });
  it('«bitrix» lleva a conectar', () => {
    expect(enlaceEscritorio('', '?view=oficina&escritorio=bitrix')).toEqual({ tipo: 'bitrix' });
  });
  it('un código mal formado se ignora', () => {
    expect(enlaceEscritorio('?escritorio=K7P3Q0')).toBeNull();
    expect(enlaceEscritorio('?escritorio=<script>')).toBeNull();
  });
  it('sin parámetro, nada', () => expect(enlaceEscritorio('?view=tiempos', null)).toBeNull());
});

describe('ofrecer la app', () => {
  const AHORA = Date.parse('2026-10-02T20:00:00Z');
  const publicada = { version: '0.8.5', tamano: 112_000_000, tamanoTexto: '107 MB', fecha: '2026-10-02' };
  const uso = (x: object = {}) => ({ instalada: false, version: null, ultimaVez: null, alDia: false, companeros: 3, publicada, ...x });

  it('se ofrece a quien no la tiene', () => {
    expect(debeOfrecer(uso(), null, AHORA)).toBe(true);
  });

  it('no a quien ya la tiene, ni si no hay nada publicado, ni sin datos', () => {
    expect(debeOfrecer(uso({ instalada: true }), null, AHORA)).toBe(false);
    expect(debeOfrecer(uso({ publicada: null }), null, AHORA)).toBe(false);
    expect(debeOfrecer(null, null, AHORA)).toBe(false);
  });

  it('«Ahora no» la esconde 3 días y después vuelve', () => {
    const hasta = posponerHasta(AHORA);
    expect(debeOfrecer(uso(), hasta, AHORA + 2 * 86_400_000)).toBe(false);
    expect(debeOfrecer(uso(), hasta, AHORA + 3 * 86_400_000)).toBe(true);
  });

  it.each([[null, null], ['', null], ['abc', null], ['1790971200000', 1790971200000]])('leerPospuesto(%p) → %p', (v, r) => {
    expect(leerPospuesto(v)).toBe(r);
  });

  it('cuenta compañeros sin inventar: con cero no dice nada', () => {
    expect(textoCompaneros(0)).toBeNull();
    expect(textoCompaneros(1)).toBe('Ya la usa 1 compañero');
    expect(textoCompaneros(7)).toBe('Ya la usan 7 compañeros');
  });
});
