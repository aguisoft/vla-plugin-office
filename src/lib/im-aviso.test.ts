import { describe, it, expect } from 'vitest';
import {
  decidirAviso, registrarAvisoInmediato, saltosTrasFallos, totalSinLeer,
  dialogoValido, textoMensaje, vistaPrevia,
} from './im-aviso';

describe('decidirAviso', () => {
  it('la primera consulta fija la base y NO avisa, aunque haya no leídos viejos', () => {
    expect(decidirAviso(null, 7)).toEqual({ avisar: false, nuevos: 0, base: 7 });
  });

  it('si el contador subió, avisa la diferencia', () => {
    expect(decidirAviso(2, 5)).toEqual({ avisar: true, nuevos: 3, base: 5 });
  });

  it('igual no avisa', () => {
    expect(decidirAviso(4, 4)).toEqual({ avisar: false, nuevos: 0, base: 4 });
  });

  it('si bajó (la persona leyó), la base baja y no avisa', () => {
    expect(decidirAviso(6, 1)).toEqual({ avisar: false, nuevos: 0, base: 1 });
  });

  it('después de bajar, un mensaje nuevo sí se avisa', () => {
    const tras = decidirAviso(6, 1);
    expect(decidirAviso(tras.base, 2).avisar).toBe(true);
  });
});

describe('camino inmediato + consulta de respaldo, sin doble aviso', () => {
  it('aviso inmediato y luego consulta sin mensajes nuevos: no avisa otra vez', () => {
    const base = registrarAvisoInmediato(2); // llegó 1 por el proxy y ya se avisó
    expect(decidirAviso(base, 3).avisar).toBe(false);
  });

  it('aviso inmediato más otro mensaje llegado por Bitrix: avisa solo uno', () => {
    const base = registrarAvisoInmediato(2);
    expect(decidirAviso(base, 4)).toEqual({ avisar: true, nuevos: 1, base: 4 });
  });

  it('sin base todavía, el aviso inmediato no inventa una', () => {
    expect(registrarAvisoInmediato(null)).toBeNull();
  });
});

describe('saltosTrasFallos', () => {
  it('sin fallos no se saltea nada', () => expect(saltosTrasFallos(0)).toBe(0));
  it('crece al doble', () => expect([1, 2, 3, 4].map(saltosTrasFallos)).toEqual([1, 2, 4, 8]));
  it('tiene tope', () => expect(saltosTrasFallos(30)).toBe(16));
});

describe('totalSinLeer', () => {
  it('usa TYPE.ALL', () => {
    expect(totalSinLeer({ TYPE: { ALL: 5, DIALOG: 3, CHAT: 2 } })).toBe(5);
  });

  it('si no viene ALL, suma los tipos', () => {
    expect(totalSinLeer({ TYPE: { DIALOG: 3, CHAT: 2, NOTIFY: 1 } })).toBe(6);
  });

  it.each([[null], [{}], [{ TYPE: {} }], ['x']])('una forma inesperada da null, no 0: %p', (r) => {
    expect(totalSinLeer(r)).toBeNull();
  });
});

describe('dialogoValido', () => {
  it.each([['949'], ['chat123']])('acepta %s', (d) => expect(dialogoValido(d)).toBe(true));
  it.each([[''], ['chat'], ['949; DROP'], [949], ['sg12'], [undefined]])(
    'rechaza %p', (d) => expect(dialogoValido(d)).toBe(false));
});

describe('textoMensaje', () => {
  it('recorta espacios', () => expect(textoMensaje('  hola  ')).toBe('hola'));
  it('vacío no sirve', () => expect(textoMensaje('   ')).toBeNull());
  it('2000 sí, 2001 no', () => {
    expect(textoMensaje('a'.repeat(2000))).toHaveLength(2000);
    expect(textoMensaje('a'.repeat(2001))).toBeNull();
  });
  it('lo que no es texto no sirve', () => expect(textoMensaje(42)).toBeNull());
});

describe('vistaPrevia', () => {
  it('junta líneas', () => expect(vistaPrevia('hola\n\ncómo  estás')).toBe('hola cómo estás'));
  it('corta largo con elipsis', () => {
    const v = vistaPrevia('a'.repeat(300));
    expect(v).toHaveLength(120);
    expect(v.endsWith('…')).toBe(true);
  });
});
