import { describe, it, expect } from 'vitest';
import { esConversacion, unirRecientes, completarSinLeer, idsSinLeerFaltantes, cuentaActiva, ajustarContadores } from './im-recientes';

const usuario = (id: string) => ({ id, type: 'user' });
const chat = (id: string, tipo: string) => ({ id, type: 'chat', chat: { type: tipo } });

describe('esConversacion', () => {
  it('los diálogos directos sí', () => expect(esConversacion(usuario('949'))).toBe(true));
  it('el chat general y los de grupos sí', () => {
    expect(esConversacion(chat('chat1', 'general'))).toBe(true);
    expect(esConversacion(chat('chat2', 'collab'))).toBe(true);
  });
  /** 225 de 234 en producción: tapaban las conversaciones de verdad. */
  it('los chats de tareas no', () => expect(esConversacion(chat('chat9', 'tasksTask'))).toBe(false));
  it('las notificaciones u otros tipos no', () => expect(esConversacion({ id: 'x', type: 'notification' })).toBe(false));
});

describe('unirRecientes', () => {
  it('junta diálogos y chats, sin repetidos y sin tareas, respetando el orden', () => {
    const dialogos = [usuario('949'), usuario('1001')];
    const chats = [chat('chat1', 'general'), chat('chat9', 'tasksTask'), usuario('949')];
    expect(unirRecientes(dialogos, chats).map(i => i.id)).toEqual(['949', '1001', 'chat1']);
  });

  it('una respuesta que no es lista se ignora', () => {
    expect(unirRecientes({ error: 'x' }, [usuario('1')]).map(i => i.id)).toEqual(['1']);
  });
});

describe('completarSinLeer', () => {
  /** El caso real: 5 diálogos sin leer, la lista traía 2. */
  const contadores = { DIALOG: { '240713': 1, '258987': 1, '999': 0 } };
  const base = [{ id: '258987', type: 'user' }, { id: 'chat1', type: 'chat' }];

  it('agrega primero los diálogos sin leer que faltaban, con su nombre', () => {
    const r = completarSinLeer(base, contadores, { 240713: { name: 'Ana Pérez', avatar: 'https://a/1.png', color: '#f00' } });
    expect(r.map(i => i.id)).toEqual(['240713', '258987', 'chat1']);
    expect(r[0]).toMatchObject({ type: 'user', title: 'Ana Pérez', counter: 1, oculta: true, avatar: { url: 'https://a/1.png' } });
  });

  it('no duplica los que ya estaban ni agrega los que están en 0', () => {
    expect(completarSinLeer(base, contadores, {}).filter(i => i.id === '258987')).toHaveLength(1);
    expect(completarSinLeer(base, contadores, {}).some(i => i.id === '999')).toBe(false);
  });

  it('sin nombre disponible, igual aparece', () => {
    expect(completarSinLeer(base, contadores, null)[0].title).toBe('Conversación sin nombre');
  });

  it('contadores raros no rompen la lista', () => {
    expect(completarSinLeer(base, null, null)).toBe(base);
  });
});

describe('idsSinLeerFaltantes', () => {
  it('solo los que faltan y tienen sin leer', () => {
    expect(idsSinLeerFaltantes([{ id: '1' }], { DIALOG: { '1': 2, '2': 1, '3': 0 } })).toEqual([2]);
  });
  it('con tope', () => {
    const muchos = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(i + 1), 1]));
    expect(idsSinLeerFaltantes([], { DIALOG: muchos })).toHaveLength(20);
  });
});

describe('cuentaActiva', () => {
  it('activa o sin el dato: sí', () => {
    expect(cuentaActiva({ active: true })).toBe(true);
    expect(cuentaActiva({ name: 'Bot' })).toBe(true);
  });
  it('desactivada o que Bitrix no devuelve: no', () => {
    expect(cuentaActiva({ active: false })).toBe(false);
    expect(cuentaActiva(undefined)).toBe(false);
  });
});

describe('ajustarContadores', () => {
  /** La forma real del 1-oct-2026: 5 diálogos sin leer, 4 de cuentas desactivadas. */
  const real = {
    TYPE: { ALL: 1165, DIALOG: 5, CHAT: 103, LINES: 0 },
    DIALOG: { '240713': 1, '240717': 1, '240719': 1, '240753': 1, '258987': 1 },
    CHAT: { '1': 100 },
  };
  const activos = new Set(['258987']);

  it('saca los diálogos de cuentas desactivadas y recalcula TYPE.DIALOG', () => {
    const r = ajustarContadores(real, id => activos.has(id));
    expect(r.DIALOG).toEqual({ '258987': 1 });
    expect(r.TYPE.DIALOG).toBe(1);
  });

  it('no toca chats ni el resto de los tipos', () => {
    const r = ajustarContadores(real, id => activos.has(id));
    expect(r.CHAT).toEqual(real.CHAT);
    expect(r.TYPE.CHAT).toBe(103);
  });

  it('no modifica la respuesta original', () => {
    ajustarContadores(real, () => false);
    expect(real.TYPE.DIALOG).toBe(5);
  });

  it('una respuesta sin DIALOG queda igual', () => {
    expect(ajustarContadores({ TYPE: {} }, () => false)).toEqual({ TYPE: {} });
  });
});
