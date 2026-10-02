import { describe, it, expect } from 'vitest';
import {
  decidirAviso, registrarAvisoInmediato, saltosTrasFallos, totalSinLeer,
  dialogoValido, textoMensaje, vistaPrevia,
} from './im-aviso';
import * as imAviso from './im-aviso';

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
  /** La forma real de producción, 1-oct-2026. */
  const REAL = { TYPE: { ALL: 1165, NOTIFY: 52, CHAT: 103, LINES: 0, DIALOG: 5, COPILOT: 0, COLLAB: 0, MESSENGER: 1113, TASKS_TASK: 979, VIBECODE_APP: 0 } };

  it('suma solo conversaciones: directos, chats y canales abiertos', () => {
    expect(totalSinLeer(REAL)).toBe(108);
  });

  it('una tarea que se mueve no cuenta como mensaje', () => {
    const conTareaNueva = { TYPE: { ...REAL.TYPE, ALL: 1166, TASKS_TASK: 980 } };
    expect(totalSinLeer(conTareaNueva)).toBe(totalSinLeer(REAL));
  });

  it('una notificación tampoco', () => {
    const conAviso = { TYPE: { ...REAL.TYPE, ALL: 1166, NOTIFY: 53 } };
    expect(totalSinLeer(conAviso)).toBe(108);
  });

  it.each([[null], [{}], [{ TYPE: {} }], [{ TYPE: { ALL: 5 } }], ['x']])('sin conversaciones en la respuesta da null, no 0: %p', (r) => {
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
  it('una mención se ve como @Nombre, sin BBCode', () => {
    expect(vistaPrevia('hola [USER=13545]Ismael Ramos[/USER], mirá [b]esto[/b]')).toBe('hola @Ismael Ramos, mirá esto');
  });
  it('junta líneas', () => expect(vistaPrevia('hola\n\ncómo  estás')).toBe('hola cómo estás'));
  it('corta largo con elipsis', () => {
    const v = vistaPrevia('a'.repeat(300));
    expect(v).toHaveLength(120);
    expect(v.endsWith('…')).toBe(true);
  });
});

describe('avisos chat por chat', () => {
  const { instantanea, subidas, sumarAvisado } = imAviso;
  // El caso que se perdía: leyó 3 en un chat y le llegaron 3 en otro; el total no cambió.
  it('avisa lo nuevo aunque el total no suba', () => {
    const antes = instantanea({ DIALOG: { 949: 3 }, CHAT: {} });
    expect(subidas(antes, { DIALOG: { 949: 0 }, CHAT: { 455313: 3 } })).toEqual({ nuevos: 3, chats: ['455313'], dialogos: 0 });
  });

  it('suma por conversación y cuenta los directos', () => {
    const antes = instantanea({ DIALOG: { 1: 1, 2: 0 }, CHAT: { 9: 2 } });
    expect(subidas(antes, { DIALOG: { 1: 2, 2: 1, 3: 4 }, CHAT: { 9: 2 } })).toEqual({ nuevos: 6, chats: [], dialogos: 3 });
  });

  it('la primera consulta fija la base sin avisar', () => {
    expect(subidas(null, { DIALOG: { 1: 5 } })).toEqual({ nuevos: 0, chats: [], dialogos: 0 });
  });

  it('lo que ya avisó el camino inmediato no se repite', () => {
    let base = instantanea({ DIALOG: { 949: 0 }, CHAT: { 77: 1 } });
    base = sumarAvisado(base, '949')!;
    base = sumarAvisado(base, 'chat77')!;
    expect(subidas(base, { DIALOG: { 949: 1 }, CHAT: { 77: 2 } }).nuevos).toBe(0);
    // Y si llegó otro más, ese sí.
    expect(subidas(base, { DIALOG: { 949: 2 }, CHAT: { 77: 2 } }).nuevos).toBe(1);
    expect(sumarAvisado(null, '949')).toBeNull();
  });
});
