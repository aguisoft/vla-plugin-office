import { describe, it, expect } from 'vitest';
import { esConversacion, unirRecientes } from './im-recientes';

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
