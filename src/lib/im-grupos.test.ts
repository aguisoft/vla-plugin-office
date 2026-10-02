import { describe, it, expect } from 'vitest';
import { chatIdDe, silenciadoPor, mencionados, destinatariosDeGrupo, tituloGrupo, idsDeUsuarios, novedades, textoNovedades, armarMiembros } from './im-grupos';

describe('chatIdDe', () => {
  it('chatN → N', () => expect(chatIdDe('chat469053')).toBe(469053));
  it.each([['949'], ['chat'], ['chat1;x'], [null]])('no es grupo: %p', (d) => expect(chatIdDe(d)).toBeNull());
});

describe('silenciadoPor', () => {
  /** Las dos formas vistas en el portal. */
  it('lista vacía: nadie', () => expect(silenciadoPor([], 949)).toBe(false));
  it('lista con el id', () => expect(silenciadoPor([949, '13545'], '13545')).toBe(true));
  it('objeto { id: true }', () => {
    expect(silenciadoPor({ 949: true }, '949')).toBe(true);
    expect(silenciadoPor({ 949: false }, '949')).toBe(false);
  });
  it('sin dato, no', () => expect(silenciadoPor(undefined, 949)).toBe(false));
});

describe('mencionados', () => {
  it('saca los ids de las menciones', () => {
    expect([...mencionados('hola [USER=13545]Ismael[/USER] y [USER=5935]Ramiro[/USER]')]).toEqual(['13545', '5935']);
  });
});

describe('destinatariosDeGrupo', () => {
  const vla = new Map([['949', 'carlos'], ['13545', 'ismael'], ['5935', 'ramiro']]);
  const miembros = ['949', '13545', '5935', '777']; // 777: alguien de Bitrix que no está en office

  it('avisa a los del equipo menos a quien escribe', () => {
    expect(destinatariosDeGrupo(miembros, vla, 'carlos', [], 'hola')).toEqual([
      { userId: 'ismael', mencion: false },
      { userId: 'ramiro', mencion: false },
    ]);
  });

  it('quien silenció el grupo no recibe aviso', () => {
    expect(destinatariosDeGrupo(miembros, vla, 'carlos', ['5935'], 'hola').map(d => d.userId)).toEqual(['ismael']);
  });

  it('…salvo que lo mencionen', () => {
    expect(destinatariosDeGrupo(miembros, vla, 'carlos', { 5935: true }, 'ojo [USER=5935]Ramiro[/USER]')).toEqual([
      { userId: 'ismael', mencion: false },
      { userId: 'ramiro', mencion: true },
    ]);
  });
});

describe('tituloGrupo', () => {
  it('recorta y junta espacios', () => expect(tituloGrupo('  Ventas   Q4 ')).toBe('Ventas Q4'));
  it('vacío o larguísimo no', () => {
    expect(tituloGrupo('   ')).toBeNull();
    expect(tituloGrupo('a'.repeat(101))).toBeNull();
  });
});

describe('idsDeUsuarios', () => {
  it('ids únicos', () => expect(idsDeUsuarios(['13545', 5935, '13545'])).toEqual([13545, 5935]));
  it('algo raro invalida la lista', () => {
    expect(idsDeUsuarios(['13545', 'x'])).toBeNull();
    expect(idsDeUsuarios('13545')).toBeNull();
  });
  it('lista vacía vale (grupo solo con quien lo crea)', () => expect(idsDeUsuarios([])).toEqual([]));
});

describe('novedades y su texto', () => {
  const antes = { CHAT: { '10': 1, '20': 0 }, DIALOG: { '949': 0 } };
  const ahora = { CHAT: { '10': 3, '20': 1, '30': 2 }, DIALOG: { '949': 1, '13545': 1 } };
  const nombres: Record<string, string> = { '10': 'Ventas', '20': 'B2B', '30': 'Marketing' };

  it('detecta qué grupos y cuántos directos subieron', () => {
    expect(novedades(antes, ahora)).toEqual({ chats: ['10', '20', '30'], dialogos: 2 });
  });

  it('la primera lectura no tiene novedades', () => expect(novedades(null, ahora)).toEqual({ chats: [], dialogos: 0 }));

  it('arma un texto que dice de dónde vienen', () => {
    expect(textoNovedades({ chats: ['10'], dialogos: 0 }, id => nombres[id], 2)).toBe('Mensajes nuevos en Ventas');
    expect(textoNovedades({ chats: ['10', '20', '30'], dialogos: 1 }, id => nombres[id], 5)).toBe('Mensajes nuevos en Ventas y 2 grupos más y 1 conversación directa');
    expect(textoNovedades({ chats: [], dialogos: 2 }, id => nombres[id], 2)).toBe('Mensajes nuevos 2 conversaciones directas');
  });

  it('sin saber de dónde, el texto de siempre', () => {
    expect(textoNovedades({ chats: [], dialogos: 0 }, () => null, 3)).toBe('Tenés 3 mensajes nuevos sin leer');
  });
});

describe('armarMiembros', () => {
  const info = { miembros: ['777', '1001', '949', '13545'], duenoId: '949', adminIds: ['949'] };
  const equipo = [
    { bitrixUserId: '949', nombre: 'Carlos Aguinaga', status: 'AVAILABLE', enOficina: true },
    { bitrixUserId: '13545', nombre: 'Ismael Ramos', status: 'LUNCH', enOficina: true, hasta: 'x' },
    { bitrixUserId: '1001', nombre: 'Ana Pérez', status: 'OFFLINE', enOficina: false },
  ];
  const m = armarMiembros(info, equipo, { 777: { name: 'Proveedor Externo' } }, '949');

  it('yo primero, el equipo por nombre, la gente de fuera al final', () => {
    expect(m.map(x => x.nombre)).toEqual(['Carlos Aguinaga', 'Ana Pérez', 'Ismael Ramos', 'Proveedor Externo']);
  });

  it('marca dueño, admin, equipo y estado', () => {
    expect(m[0]).toMatchObject({ esDueno: true, esAdmin: true, soyYo: true, status: 'AVAILABLE' });
    expect(m[2]).toMatchObject({ esEquipo: true, status: 'LUNCH', hasta: 'x' });
    expect(m[3]).toMatchObject({ esEquipo: false, status: null, enOficina: null });
  });
});
