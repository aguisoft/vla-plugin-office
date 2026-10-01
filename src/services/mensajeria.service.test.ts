import { describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@vla/plugin-sdk';
import { MensajeriaService, SinBitrixError } from './mensajeria.service';

/** Ana (VLA ana, Bitrix 949) y Beto (VLA beto, Bitrix 1001). */
const MAPEO = [
  { userId: 'ana', bitrixUserId: 949 },
  { userId: 'beto', bitrixUserId: 1001 },
];

function armar(opts: {
  tokens?: Record<string, string | null>;
  conectados?: string[];
  contadores?: (token: string) => Promise<any>;
} = {}) {
  const tokensPorUsuario = opts.tokens ?? { ana: 'TOKEN-ANA', beto: 'TOKEN-BETO' };
  const callAsUser = vi.fn(async (token: string, method: string, _params?: any) => {
    if (method === 'im.counters.get') return opts.contadores ? opts.contadores(token) : { TYPE: { DIALOG: 0 } };
    if (method === 'im.message.add') return 555;
    return [];
  });
  const doAction = vi.fn(async () => undefined);
  const ctx = {
    bitrix: { callAsUser },
    hooks: { doAction },
    prisma: {
      bitrixUserMapping: {
        findFirst: vi.fn(async ({ where }: any) =>
          MAPEO.find(m => (where.userId ? m.userId === where.userId : m.bitrixUserId === where.bitrixUserId)) ?? null),
      },
      user: {
        findUnique: vi.fn(async ({ where }: any) =>
          ({ ana: { firstName: 'Ana', lastName: 'Pérez' }, beto: { firstName: 'Beto', lastName: 'Ruiz' } } as any)[where.id] ?? null),
      },
    },
    logger: { warn: vi.fn(), error: vi.fn(), log: vi.fn() },
  } as unknown as PluginContext;
  const tokens = {
    obtenerVigente: vi.fn(async (u: string) => tokensPorUsuario[u] ?? null),
    conectados: vi.fn(async () => Object.keys(tokensPorUsuario).filter(u => tokensPorUsuario[u])),
  };
  const avisos: Array<{ userId: string; payload: any }> = [];
  const avisador = {
    broadcastToUser: (userId: string, payload: object) => { avisos.push({ userId, payload }); },
    conectados: () => opts.conectados ?? ['ana', 'beto'],
  };
  const svc = new MensajeriaService(ctx, tokens as any, avisador, async () => undefined);
  return { svc, callAsUser, doAction, avisos };
}

describe('MensajeriaService: el proxy habla como quien pregunta', () => {
  /** La prueba clave: con el token global, todo saldría firmado por Carlos. */
  it('usa el token de la persona que pide, no el de otra', async () => {
    const { svc, callAsUser } = armar();
    await svc.recientes('beto');
    expect(callAsUser).toHaveBeenCalledWith('TOKEN-BETO', 'im.recent.get', expect.any(Object));
    expect(JSON.stringify(callAsUser.mock.calls)).not.toContain('TOKEN-ANA');
  });

  it('recientes pide diálogos y chats por separado y saca los chats de tareas', async () => {
    const { svc, callAsUser } = armar();
    callAsUser.mockImplementation(async (_t: string, _m: string, p: any) =>
      p?.SKIP_CHAT ? [{ id: '1001', type: 'user' }] : [{ id: 'chat1', type: 'chat', chat: { type: 'general' } }, { id: 'chat9', type: 'chat', chat: { type: 'tasksTask' } }]);
    const r = await svc.recientes('ana');
    expect(r.map((i: any) => i.id)).toEqual(['1001', 'chat1']);
    expect(callAsUser.mock.calls.slice(0, 2).map(c => c[2])).toEqual([
      { SKIP_OPENLINES: 'Y', SKIP_CHAT: 'Y' },
      { SKIP_OPENLINES: 'Y', SKIP_DIALOG: 'Y' },
    ]);
  });

  it('recientes agrega los diálogos sin leer que Bitrix no listó, con su nombre', async () => {
    const { svc, callAsUser } = armar();
    callAsUser.mockImplementation(async (_t: string, m: string, p: any) => {
      if (m === 'im.counters.get') return { DIALOG: { '1001': 0, '4242': 2 } };
      if (m === 'im.user.list.get') return { 4242: { name: 'Externo Uno' } };
      return p?.SKIP_CHAT ? [{ id: '1001', type: 'user' }] : [];
    });
    const r = await svc.recientes('ana');
    expect(r.map((i: any) => [i.id, i.title, i.counter])).toEqual([['4242', 'Externo Uno', 2], ['1001', undefined, undefined]]);
    expect(callAsUser).toHaveBeenCalledWith('TOKEN-ANA', 'im.user.list.get', { ID: [4242] });
  });

  /** El caso real: 4 diálogos «sin leer» de cuentas desactivadas aparecían en la lista. */
  it('una cuenta desactivada no aparece ni cuenta como sin leer, y se consulta una sola vez', async () => {
    const { svc, callAsUser } = armar();
    callAsUser.mockImplementation(async (_t: string, m: string, p: any) => {
      if (m === 'im.counters.get') return { TYPE: { DIALOG: 2 }, DIALOG: { '240717': 1, '4242': 1 } };
      if (m === 'im.user.list.get') return { 240717: { name: 'Yudy', active: false }, 4242: { name: 'Activa', active: true } };
      return p?.SKIP_CHAT ? [] : [];
    });
    const r = await svc.recientes('ana');
    expect(r.map((i: any) => i.id)).toEqual(['4242']);
    expect((await svc.contadores('ana')).TYPE.DIALOG).toBe(1);
    const consultasDeActivos = callAsUser.mock.calls.filter(c => c[1] === 'im.user.list.get' && (c[2] as any).ID.includes(240717));
    expect(consultasDeActivos).toHaveLength(1);
  });

  it('si completar falla, la lista de recientes igual sale', async () => {
    const { svc, callAsUser } = armar();
    callAsUser.mockImplementation(async (_t: string, m: string, p: any) => {
      if (m === 'im.counters.get') throw new Error('[im.counters.get] QUERY_LIMIT_EXCEEDED: ');
      return p?.SKIP_CHAT ? [{ id: '1001', type: 'user' }] : [];
    });
    expect((await svc.recientes('ana')).map((i: any) => i.id)).toEqual(['1001']);
  });

  it('sin Bitrix conectado lanza SinBitrixError, nunca devuelve una lista vacía', async () => {
    const { svc, callAsUser } = armar({ tokens: { ana: null } });
    await expect(svc.recientes('ana')).rejects.toBeInstanceOf(SinBitrixError);
    expect(callAsUser).not.toHaveBeenCalled();
  });

  it('enviar manda el texto al diálogo pedido', async () => {
    const { svc, callAsUser } = armar();
    expect(await svc.enviar('ana', '1001', 'hola')).toEqual({ id: 555 });
    expect(callAsUser).toHaveBeenCalledWith('TOKEN-ANA', 'im.message.add', { DIALOG_ID: '1001', MESSAGE: 'hola' });
  });
});

describe('MensajeriaService: aviso inmediato', () => {
  it('avisa al destinatario del equipo, con quién escribe y cómo responderle', async () => {
    const { svc, avisos, doAction } = armar();
    await svc.enviar('ana', '1001', 'hola Beto');

    expect(avisos).toEqual([{ userId: 'beto', payload: { type: 'im:new', dialogId: '949', de: 'Ana Pérez', preview: 'hola Beto' } }]);
    expect(doAction).toHaveBeenCalledWith('core.push.send', expect.objectContaining({ userId: 'beto', title: 'Ana Pérez te escribió' }));
  });

  it('quien escribe no se avisa a sí mismo', async () => {
    const { svc, avisos } = armar();
    await svc.enviar('ana', '949', 'nota para mí');
    expect(avisos).toEqual([]);
  });

  it('un chat grupal o alguien de fuera del equipo no genera aviso inmediato', async () => {
    const { svc, avisos } = armar();
    await svc.enviar('ana', 'chat77', 'hola grupo');
    await svc.enviar('ana', '4242', 'hola externo');
    expect(avisos).toEqual([]);
  });

  it('si el aviso falla, el mensaje igual cuenta como enviado', async () => {
    const { svc, doAction } = armar();
    doAction.mockRejectedValueOnce(new Error('push caído'));
    await expect(svc.enviar('ana', '1001', 'hola')).resolves.toEqual({ id: 555 });
  });
});

describe('MensajeriaService: consulta de respaldo', () => {
  it('primera consulta en silencio; si sube el contador, avisa', async () => {
    let total = 3;
    const { svc, avisos } = armar({ conectados: ['beto'], contadores: async () => ({ TYPE: { DIALOG: total } }) });

    await svc.consultarRespaldo();
    expect(avisos).toEqual([]);

    total = 5;
    await svc.consultarRespaldo();
    expect(avisos).toEqual([{ userId: 'beto', payload: { type: 'im:new', nuevos: 2 } }]);
  });

  it('un mensaje ya avisado por el proxy no se vuelve a avisar en la consulta', async () => {
    let total = 0;
    const { svc, avisos } = armar({ conectados: ['beto'], contadores: async () => ({ TYPE: { DIALOG: total } }) });
    await svc.consultarRespaldo(); // base 0

    await svc.enviar('ana', '1001', 'hola'); // aviso inmediato a Beto
    total = 1;
    await svc.consultarRespaldo();

    expect(avisos.filter(a => a.userId === 'beto')).toHaveLength(1);
  });

  it('solo consulta a quien tiene una conexión viva Y Bitrix conectado', async () => {
    const { svc, callAsUser } = armar({ tokens: { ana: 'TOKEN-ANA', beto: null }, conectados: ['beto', 'carla'] });
    await svc.consultarRespaldo();
    expect(callAsUser).not.toHaveBeenCalled();
  });

  it('tras un error se saltea a esa persona con retroceso, y vuelve después', async () => {
    let falla = true;
    const { svc, callAsUser } = armar({
      conectados: ['ana'],
      contadores: async () => { if (falla) throw new Error('fetch failed'); return { TYPE: { DIALOG: 0 } }; },
    });
    await svc.consultarRespaldo(); // falla 1 → saltea 1
    await svc.consultarRespaldo(); // salteada
    expect(callAsUser).toHaveBeenCalledTimes(1);
    falla = false;
    await svc.consultarRespaldo();
    expect(callAsUser).toHaveBeenCalledTimes(2);
  });

  it('ante el límite de Bitrix corta la ronda: no sigue con los demás', async () => {
    const { svc, callAsUser } = armar({
      contadores: async () => { throw new Error('[im.counters.get] QUERY_LIMIT_EXCEEDED: '); },
    });
    await svc.consultarRespaldo();
    expect(callAsUser).toHaveBeenCalledTimes(1);
  });

  it('las personas se consultan de a una, nunca en paralelo', async () => {
    let enVuelo = 0; let maximo = 0;
    const { svc } = armar({
      contadores: async () => { enVuelo++; maximo = Math.max(maximo, enVuelo); await new Promise(r => setTimeout(r, 5)); enVuelo--; return { TYPE: { DIALOG: 0 } }; },
    });
    await svc.consultarRespaldo();
    expect(maximo).toBe(1);
  });
});

describe('MensajeriaService: chat ampliado', () => {
  /** El REPLY_ID de im.message.add se ignora en el portal: hay que usar la v2. */
  it('responder va por la API v2 con replyId, con el token de quien escribe', async () => {
    const { svc, callAsUser } = armar();
    callAsUser.mockImplementation(async (_t: string, m: string) => (m === 'im.v2.Chat.Message.send' ? { id: 777 } : 555));
    expect(await svc.enviar('ana', '1001', 'de acuerdo', 19731873)).toEqual({ id: 777 });
    expect(callAsUser).toHaveBeenCalledWith('TOKEN-ANA', 'im.v2.Chat.Message.send', { dialogId: '1001', fields: { message: 'de acuerdo', replyId: 19731873 } });
  });

  it('sin respuesta sigue por im.message.add', async () => {
    const { svc, callAsUser } = armar();
    await svc.enviar('ana', '1001', 'hola');
    expect(callAsUser).toHaveBeenCalledWith('TOKEN-ANA', 'im.message.add', { DIALOG_ID: '1001', MESSAGE: 'hola' });
  });

  it('reaccionar agrega o quita según se pida', async () => {
    const { svc, callAsUser } = armar();
    await svc.reaccionar('ana', 5, 'laugh', false);
    await svc.reaccionar('ana', 5, 'laugh', true);
    expect(callAsUser.mock.calls.map(c => c[1])).toEqual(['im.v2.Chat.Message.Reaction.add', 'im.v2.Chat.Message.Reaction.delete']);
    expect(callAsUser.mock.calls[0][2]).toEqual({ messageId: 5, reaction: 'laugh' });
  });

  it('un archivo recorre chat → carpeta → subida → publicación, y avisa al destinatario', async () => {
    const { svc, callAsUser, avisos } = armar();
    callAsUser.mockImplementation(async (_t: string, m: string) => ({
      'im.dialog.get': { id: 87399 },
      'im.disk.folder.get': { ID: 1573295 },
      'disk.folder.uploadfile': { ID: 1573297 },
      'im.disk.file.commit': { MESSAGE_ID: 19733283 },
    } as any)[m] ?? []);
    expect(await svc.enviarArchivo('ana', '1001', 'informe.pdf', 'aG9sYQ==')).toEqual({ id: 19733283 });
    expect(callAsUser.mock.calls.map(c => c[1])).toEqual(['im.dialog.get', 'im.disk.folder.get', 'disk.folder.uploadfile', 'im.disk.file.commit']);
    expect(callAsUser.mock.calls[2][2]).toEqual({ id: 1573295, data: { NAME: 'informe.pdf' }, fileContent: ['informe.pdf', 'aG9sYQ=='], generateUniqueName: true });
    expect(callAsUser.mock.calls[3][2]).toEqual({ CHAT_ID: 87399, FILE_ID: 1573297 });
    expect(callAsUser.mock.calls.every(c => c[0] === 'TOKEN-ANA')).toBe(true);
    expect(avisos).toEqual([{ userId: 'beto', payload: expect.objectContaining({ type: 'im:new', preview: '📎 informe.pdf' }) }]);
  });

  it('el hilo se pide con la API v2, que trae reacciones y archivos', async () => {
    const { svc, callAsUser } = armar();
    await svc.hilo('ana', 'chat77');
    expect(callAsUser).toHaveBeenCalledWith('TOKEN-ANA', 'im.v2.Chat.Message.list', { dialogId: 'chat77', limit: 50 });
  });
});
