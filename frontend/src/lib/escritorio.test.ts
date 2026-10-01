import { describe, it, expect } from 'vitest';
import {
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
