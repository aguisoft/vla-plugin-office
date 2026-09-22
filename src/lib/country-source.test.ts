import { describe, it, expect } from 'vitest';
import { resolveCountry, resolveManager } from './country-source';

describe('resolveCountry — precedencia', () => {
  it('el override gana sobre Bitrix y sobre el default', () => {
    expect(resolveCountry('AR', 'CR', 'NI')).toEqual({ country: 'AR', source: 'override' });
  });

  it('sin override, gana Bitrix', () => {
    expect(resolveCountry(null, 'CR', 'NI')).toEqual({ country: 'CR', source: 'bitrix' });
  });

  it('sin override ni Bitrix, cae al default y lo dice', () => {
    expect(resolveCountry(null, null, 'CR')).toEqual({ country: 'CR', source: 'default' });
  });

  it('el estado de hoy en produccion: todos null -> default', () => {
    // 35 mapeos con country = null. El origen tiene que decir 'default' para
    // que la pantalla no muestre un CR inventado como si fuera verificado.
    expect(resolveCountry(undefined, null, 'CR').source).toBe('default');
  });
});

describe('resolveCountry — cadenas vacias', () => {
  it('trata "" de Bitrix como ausencia y cae al default', () => {
    expect(resolveCountry(null, '', 'CR')).toEqual({ country: 'CR', source: 'default' });
  });

  it('trata "" de override como ausencia y cae a Bitrix', () => {
    expect(resolveCountry('', 'AR', 'CR')).toEqual({ country: 'AR', source: 'bitrix' });
  });

  it('ignora espacios en blanco', () => {
    expect(resolveCountry('   ', '  ', 'CR')).toEqual({ country: 'CR', source: 'default' });
  });
});

describe('resolveCountry — normalizacion', () => {
  it('devuelve el ISO en mayusculas venga como venga', () => {
    expect(resolveCountry('ar', null, 'CR').country).toBe('AR');
    expect(resolveCountry(null, 'cr', 'NI').country).toBe('CR');
    expect(resolveCountry(null, null, 'ni').country).toBe('NI');
  });

  it('recorta espacios alrededor del valor', () => {
    expect(resolveCountry(' AR ', null, 'CR').country).toBe('AR');
  });
});

describe('resolveManager', () => {
  const heads = new Map([['21', 'jefe-a'], ['22', 'jefe-b']]);

  it('el override gana sobre el jefe del departamento', () => {
    expect(resolveManager('u1', 'otro-jefe', '21', heads)).toEqual({
      managerUserId: 'otro-jefe',
      source: 'override',
    });
  });

  it('sin override, toma el jefe del departamento', () => {
    expect(resolveManager('u1', null, '21', heads)).toEqual({
      managerUserId: 'jefe-a',
      source: 'bitrix',
    });
  });

  it('sin departamento devuelve null sin jefe', () => {
    expect(resolveManager('u1', null, null, heads)).toEqual({
      managerUserId: null,
      source: 'none',
    });
  });

  it('departamento sin jefe registrado devuelve null', () => {
    expect(resolveManager('u1', null, '99', heads)).toEqual({
      managerUserId: null,
      source: 'none',
    });
  });

  it('nadie es su propio jefe por la via del departamento', () => {
    expect(resolveManager('jefe-a', null, '21', heads)).toEqual({
      managerUserId: null,
      source: 'none',
    });
  });

  it('nadie es su propio jefe por la via del override', () => {
    expect(resolveManager('u1', 'u1', '21', heads)).toEqual({
      managerUserId: 'jefe-a',
      source: 'bitrix',
    });
  });
});
