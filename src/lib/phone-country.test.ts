import { describe, it, expect } from 'vitest';
import {
  countryFromPhone,
  hasInternationalPrefix,
  phoneShape,
  prefixOf,
  digitsOf,
} from './phone-country';

describe('countryFromPhone — códigos de Centroamérica', () => {
  const cases: Array<[string, string]> = [
    ['+50688887777', 'CR'],
    ['+50588887777', 'NI'],
    ['+50788887777', 'PA'],
    ['+50288887777', 'GT'],
    ['+50388887777', 'SV'],
    ['+50488887777', 'HN'],
    ['+50188887777', 'BZ'],
  ];
  for (const [phone, iso] of cases) {
    it(`${phone} → ${iso}`, () => {
      expect(countryFromPhone(phone)).toBe(iso);
    });
  }

  it('no confunde países vecinos: 505 y 506 son distintos', () => {
    expect(countryFromPhone('+50600000001')).toBe('CR');
    expect(countryFromPhone('+50500000001')).toBe('NI');
  });
});

describe('countryFromPhone — formatos', () => {
  it('tolera espacios, guiones y paréntesis', () => {
    expect(countryFromPhone('+506 8888-7777')).toBe('CR');
    expect(countryFromPhone('+(506) 8888 7777')).toBe('CR');
  });

  it('acepta el prefijo internacional con 00', () => {
    expect(countryFromPhone('0050688887777')).toBe('CR');
  });

  it('devuelve null para un número local sin código de país', () => {
    // 8 dígitos, formato tico local. Leerle los primeros 3 daría "506"→CR por
    // casualidad en algunos casos y un país inventado en otros.
    expect(countryFromPhone('88887777')).toBeNull();
    expect(countryFromPhone('2222-3333')).toBeNull();
  });

  it('devuelve null para 10+ dígitos sin + explícito, en vez de adivinar', () => {
    expect(countryFromPhone('50688887777')).toBeNull();
  });

  it('devuelve null para un prefijo que no está en la tabla', () => {
    expect(countryFromPhone('+7999123456')).toBeNull(); // Rusia, fuera de tabla
  });

  it('devuelve null para vacío, null y undefined', () => {
    expect(countryFromPhone('')).toBeNull();
    expect(countryFromPhone(null)).toBeNull();
    expect(countryFromPhone(undefined)).toBeNull();
  });

  it('devuelve null para texto sin dígitos', () => {
    expect(countryFromPhone('+n/a')).toBeNull();
  });
});

describe('hasInternationalPrefix', () => {
  it('true con + o 00', () => {
    expect(hasInternationalPrefix('+50688887777')).toBe(true);
    expect(hasInternationalPrefix('0050688887777')).toBe(true);
  });

  it('false sin prefijo explícito, incluso si parece traer el código pegado', () => {
    expect(hasInternationalPrefix('50688887777')).toBe(false);
    expect(hasInternationalPrefix('88887777')).toBe(false);
  });
});

describe('phoneShape — clasifica sin exponer el número', () => {
  it('international para un prefijo reconocido', () => {
    expect(phoneShape('+50688887777')).toBe('international');
  });

  it('international-unknown-prefix para uno fuera de tabla', () => {
    expect(phoneShape('+7999123456')).toBe('international-unknown-prefix');
  });

  it('local para formato sin código de país', () => {
    expect(phoneShape('88887777')).toBe('local');
  });

  it('empty para vacío o sin dígitos', () => {
    expect(phoneShape('')).toBe('empty');
    expect(phoneShape(null)).toBe('empty');
    expect(phoneShape('n/a')).toBe('empty');
  });
});

describe('prefixOf — solo el código de país, nunca más dígitos', () => {
  it('devuelve el prefijo con +', () => {
    expect(prefixOf('+506 8888-7777')).toBe('+506');
    expect(prefixOf('+50588887777')).toBe('+505');
  });

  it('null para local o desconocido', () => {
    expect(prefixOf('88887777')).toBeNull();
    expect(prefixOf('+7999123456')).toBeNull();
  });

  it('no filtra dígitos del número, solo el código', () => {
    const p = prefixOf('+50687654321');
    expect(p).toBe('+506');
    expect(p).not.toContain('8765');
  });
});

describe('digitsOf', () => {
  it('extrae solo dígitos', () => {
    expect(digitsOf('+506 8888-7777')).toBe('50688887777');
    expect(digitsOf('(506) 8888 7777 ext. 12')).toBe('5068888777712');
  });
});
