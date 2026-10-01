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
