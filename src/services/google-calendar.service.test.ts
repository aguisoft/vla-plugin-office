import { describe, it, expect, vi } from 'vitest';
import { GoogleCalendarService, ErrorGoogle } from './google-calendar.service';
import { firmarEstado, type EventoDeseado } from '../lib/google-calendar';

const SECRETO = 'secreto';
const AHORA = new Date('2026-10-14T16:00:00Z');

/** Una base en memoria con solo las tres tablas de Google, y un Google de mentira. */
function armar(google: (url: string, init: any) => { status?: number; body?: any }) {
  const tokens = new Map<string, any>();
  const eventos = new Map<string, any>();
  const estado = new Map<string, any>();
  const query = vi.fn(async (sql: string, p: any[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('INSERT INTO office_google_tokens')) {
      tokens.set(p[0], { user_id: p[0], email: p[1], refresh_token: p[2], access_token: p[3], expires_at: p[4], scope: p[5], conectado_en: 'ahora' });
      return [];
    }
    if (s.startsWith('UPDATE office_google_tokens')) { Object.assign(tokens.get(p[0]), { access_token: p[1], expires_at: p[2] }); return []; }
    if (s.startsWith('SELECT') && s.includes('FROM office_google_tokens WHERE user_id')) { const t = tokens.get(p[0]); return t ? [t] : []; }
    if (s.startsWith('SELECT user_id FROM office_google_tokens')) return [...tokens.keys()].map(user_id => ({ user_id }));
    if (s.startsWith('DELETE FROM office_google_tokens')) { tokens.delete(p[0]); return []; }
    if (s.startsWith('DELETE FROM office_google_eventos WHERE user_id = $1 AND clave')) { eventos.delete(`${p[0]}|${p[1]}`); return []; }
    if (s.startsWith('DELETE FROM office_google_eventos')) { for (const k of [...eventos.keys()]) if (k.startsWith(`${p[0]}|`)) eventos.delete(k); return []; }
    if (s.startsWith('DELETE FROM office_google_estado')) { estado.delete(p[0]); return []; }
    if (s.startsWith('INSERT INTO office_google_estado')) { estado.set(p[0], { event_id: p[1], status: p[2], titulo: p[3], soltado: false }); return []; }
    if (s.startsWith('UPDATE office_google_estado')) { if (estado.has(p[0])) estado.get(p[0]).soltado = true; return []; }
    if (s.startsWith('SELECT event_id, status, titulo, soltado FROM office_google_estado')) { const e = estado.get(p[0]); return e ? [e] : []; }
    if (s.startsWith('SELECT clave, event_id FROM office_google_eventos')) {
      return [...eventos.values()].filter(e => e.user_id === p[0] && !e.clave.startsWith('reunion:') && new Date(e.fin) > new Date());
    }
    if (s.startsWith('INSERT INTO office_google_eventos')) {
      const conEnlace = s.includes('enlace');
      eventos.set(`${p[0]}|${p[1]}`, { user_id: p[0], clave: p[1], event_id: p[2], firma: conEnlace ? '' : p[3], inicio: conEnlace ? p[3] : p[4], fin: conEnlace ? p[4] : p[5], enlace: conEnlace ? p[5] : null });
      return [];
    }
    if (s.startsWith('UPDATE office_google_eventos SET cierre')) { eventos.get(`${p[0]}|${p[1]}`).cierre = p[2]; return []; }
    if (s.startsWith('UPDATE office_google_eventos')) { Object.assign(eventos.get(`${p[0]}|${p[1]}`), { fin: p[2], cerrada: true }); return []; }
    if (s.includes("clave LIKE 'reunion:%' AND NOT cerrada")) {
      return [...eventos.values()].filter(e => e.user_id === p[0] && e.clave.startsWith('reunion:') && !e.cerrada && new Date(e.inicio) > new Date(p[1]));
    }
    if (s.startsWith('SELECT clave, enlace')) return [...eventos.values()].filter(e => e.enlace && p.includes(e.clave));
    if (s.startsWith('SELECT clave, event_id, firma')) return [...eventos.values()].filter(e => e.user_id === p[0]);
    throw new Error('SQL no esperado en la prueba: ' + s);
  });
  const llamadas: Array<{ metodo: string; url: string; cuerpo: any }> = [];
  const http = vi.fn(async (url: string, init: any = {}) => {
    const cuerpo = typeof init.body === 'string' ? JSON.parse(init.body) : init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : undefined;
    llamadas.push({ metodo: init.method ?? 'GET', url, cuerpo });
    const r = google(url, { ...init, cuerpo });
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body ?? {} } as Response;
  });
  const ctx = { query, logger: { warn: vi.fn(), log: vi.fn(), error: vi.fn() } };
  const svc = new GoogleCalendarService(ctx as any, () => ({ clientId: 'cid', clientSecret: 'secreto-del-cliente', urlPublica: 'https://system.somosvla.com', tz: 'America/Costa_Rica', llaveEstado: SECRETO }), http as any);
  svc.dormir = async () => undefined;
  return { svc, tokens, eventos, estado, llamadas };
}

const conectar = (tokens: Map<string, any>, expira = '2099-01-01T00:00:00Z') =>
  tokens.set('ana', { user_id: 'ana', email: 'ana@grupovla.com', refresh_token: 'r1', access_token: 'a1', expires_at: expira, conectado_en: 'x' });

describe('conectar', () => {
  const tokenOk = (email: string) => (url: string) => {
    if (url.includes('oauth2.googleapis.com/token')) return { body: { access_token: 'a1', refresh_token: 'r1', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy' } };
    if (url.includes('userinfo')) return { body: { email } };
    return { body: {} };
  };

  it('guarda los tokens de una cuenta de VLA', async () => {
    const { svc, tokens } = armar(tokenOk('Ana@VLAcademy.com'));
    expect(await svc.completar('codigo', firmarEstado('ana', AHORA.getTime(), SECRETO), 'ana', AHORA.getTime())).toEqual({ userId: 'ana', email: 'ana@vlacademy.com' });
    expect(tokens.get('ana')).toMatchObject({ refresh_token: 'r1', email: 'ana@vlacademy.com' });
  });

  it('rechaza una cuenta de otro dominio y le revoca el permiso', async () => {
    const { svc, tokens, llamadas } = armar(tokenOk('ana@gmail.com'));
    await expect(svc.completar('codigo', firmarEstado('ana', AHORA.getTime(), SECRETO), 'ana', AHORA.getTime())).rejects.toMatchObject({ codigo: 'dominio' });
    expect(tokens.size).toBe(0);
    expect(llamadas.some(l => l.url.includes('/revoke'))).toBe(true);
  });

  it('rechaza un state que no firmó la oficina', async () => {
    const { svc } = armar(tokenOk('ana@grupovla.com'));
    await expect(svc.completar('codigo', firmarEstado('ana', AHORA.getTime(), 'otra'), 'ana', AHORA.getTime())).rejects.toBeInstanceOf(ErrorGoogle);
  });

  it('el state no se firma con el client secret (lo puede leer cualquiera en la configuración)', async () => {
    const { tokens, llamadas } = armar(tokenOk('ana@grupovla.com'));
    const sinLlave = new GoogleCalendarService({ query: async () => [], logger: { warn() {}, log() {}, error() {} } } as any,
      () => ({ clientId: 'cid', clientSecret: 'secreto-del-cliente', urlPublica: 'https://system.somosvla.com', tz: 'America/Costa_Rica' }), (async () => ({ ok: true, json: async () => ({}) })) as any);
    await expect(sinLlave.completar('codigo', firmarEstado('ana', AHORA.getTime(), 'secreto-del-cliente'), 'ana', AHORA.getTime()))
      .rejects.toMatchObject({ codigo: 'estado_invalido' });
    // El que sí arma la oficina vale.
    const propio = new URL(sinLlave.urlConectar('ana', AHORA.getTime())).searchParams.get('state')!;
    await expect(sinLlave.completar('', propio, 'ana', AHORA.getTime())).rejects.toMatchObject({ codigo: 'sin_codigo' });
    expect(tokens.size + llamadas.length).toBe(0);
  });

  it('si la API de Calendar no responde (no está habilitada), no guarda y revoca', async () => {
    const { svc, tokens, llamadas } = armar(url => (url.includes('/calendars/primary/events') ? { status: 403, body: { error: { message: 'accessNotConfigured' } } } : tokenOk('ana@grupovla.com')(url)));
    await expect(svc.completar('codigo', firmarEstado('ana', AHORA.getTime(), SECRETO), 'ana', AHORA.getTime())).rejects.toMatchObject({ codigo: 'api' });
    expect(tokens.size).toBe(0);
    expect(llamadas.some(l => l.url.includes('/revoke'))).toBe(true);
  });

  it('un tropiezo de Google al probar (500) no se confunde con la API apagada', async () => {
    const { svc } = armar(url => (url.includes('/calendars/primary/events') ? { status: 500 } : tokenOk('ana@grupovla.com')(url)));
    await expect(svc.completar('codigo', firmarEstado('ana', AHORA.getTime(), SECRETO), 'ana', AHORA.getTime())).rejects.toMatchObject({ codigo: 'prueba' });
  });

  it('rechaza la vuelta si en ese navegador hay otra sesión (alguien le pasó su enlace)', async () => {
    const { svc, tokens, llamadas } = armar(tokenOk('bruno@grupovla.com'));
    await expect(svc.completar('codigo', firmarEstado('ana', AHORA.getTime(), SECRETO), 'bruno', AHORA.getTime())).rejects.toMatchObject({ codigo: 'sesion' });
    await expect(svc.completar('codigo', firmarEstado('ana', AHORA.getTime(), SECRETO), null, AHORA.getTime())).rejects.toMatchObject({ codigo: 'sesion' });
    expect(tokens.size).toBe(0);
    expect(llamadas).toEqual([]);   // ni siquiera canjea el código
  });

  it('si conecta otra cuenta, borra lo que puso en la anterior y la revoca', async () => {
    const { svc, tokens, eventos, llamadas } = armar(tokenOk('ana@vlacademy.com'));
    tokens.set('ana', { user_id: 'ana', email: 'ana@grupovla.com', refresh_token: 'viejo', access_token: 'av', expires_at: '2099-01-01T00:00:00Z', conectado_en: 'x' });
    eventos.set('ana|ausencia:a1', { user_id: 'ana', clave: 'ausencia:a1', event_id: 'g-vieja', firma: 'f', inicio: '2099-01-01T00:00:00Z', fin: '2099-01-02T00:00:00Z', enlace: null });
    expect(await svc.completar('codigo', firmarEstado('ana', AHORA.getTime(), SECRETO), 'ana', AHORA.getTime())).toEqual({ userId: 'ana', email: 'ana@vlacademy.com' });
    expect(llamadas.some(l => l.metodo === 'DELETE' && l.url.includes('/events/g-vieja'))).toBe(true);
    expect(llamadas.some(l => l.url.includes('/revoke?token=viejo'))).toBe(true);
    expect(eventos.size).toBe(0);
    expect(tokens.get('ana')).toMatchObject({ email: 'ana@vlacademy.com', refresh_token: 'r1' });
  });

  it('el enlace pide los permisos de calendario y acceso sin conexión', () => {
    const { svc } = armar(() => ({}));
    const u = new URL(svc.urlConectar('ana', AHORA.getTime()));
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('scope')).toContain('calendar.events');
    expect(u.searchParams.get('redirect_uri')).toBe('https://system.somosvla.com/api/v1/p/office/google/callback');
  });
});

describe('tokens', () => {
  it('renueva el de acceso cuando está por vencer', async () => {
    const { svc, tokens, llamadas } = armar(url => url.includes('/token') ? { body: { access_token: 'a2', expires_in: 3600 } } : { body: { items: [] } });
    conectar(tokens, '2000-01-01T00:00:00Z');
    expect(await svc.eventosAhora('ana', AHORA)).toEqual([]);
    expect(tokens.get('ana').access_token).toBe('a2');
    expect(llamadas.find(l => l.url.includes('/events'))).toBeTruthy();
  });

  it('si revocó el permiso en Google, se desconecta sola', async () => {
    const { svc, tokens } = armar(url => url.includes('/token') ? { status: 400, body: { error: 'invalid_grant' } } : { body: {} });
    conectar(tokens, '2000-01-01T00:00:00Z');
    expect(await svc.eventosAhora('ana', AHORA)).toBeNull();
    expect(tokens.size).toBe(0);
  });
});

describe('reconciliar ausencias', () => {
  const vac: EventoDeseado = { clave: 'ausencia:a1', titulo: 'Vacaciones', inicio: '2026-12-21T06:00:00.000Z', fin: '2026-12-24T06:00:00.000Z', privado: false };

  it('crea «Fuera de la oficina» y lo anota; si después no va, lo borra', async () => {
    let n = 0;
    const { svc, tokens, eventos, llamadas } = armar((url, init) => (init.method === 'POST' ? { body: { id: `g${++n}` } } : { status: 204 }));
    conectar(tokens);
    expect(await svc.reconciliar('ana', [vac], AHORA)).toEqual({ creados: 1, borrados: 0 });
    const post = llamadas.find(l => l.metodo === 'POST')!;
    expect(post.cuerpo).toMatchObject({ summary: 'Vacaciones', eventType: 'outOfOffice', start: { dateTime: vac.inicio } });
    expect(eventos.get('ana|ausencia:a1')).toMatchObject({ event_id: 'g1' });

    expect(await svc.reconciliar('ana', [], AHORA)).toEqual({ creados: 0, borrados: 1 });
    expect(llamadas.at(-1)).toMatchObject({ metodo: 'DELETE' });
    expect(llamadas.at(-1)!.url).toContain('/events/g1');
    expect(eventos.size).toBe(0);
  });

  it('si Google no acepta «Fuera de la oficina», lo crea como evento común', async () => {
    const { svc, tokens, llamadas } = armar((url, init) => (init.cuerpo?.eventType ? { status: 400, body: { error: { message: 'eventType' } } } : { body: { id: 'g9' } }));
    conectar(tokens);
    expect(await svc.reconciliar('ana', [vac], AHORA)).toEqual({ creados: 1, borrados: 0 });
    expect(llamadas.filter(l => l.metodo === 'POST').map(l => !!l.cuerpo.eventType)).toEqual([true, false]);
  });

  it('si ya estaba en Google (se perdió la respuesta al crearlo), lo adopta en vez de duplicarlo', async () => {
    const { svc, tokens, eventos, llamadas } = armar((url, init) => {
      if ((init.method ?? 'GET') === 'GET' && url.includes('privateExtendedProperty')) {
        return { body: { items: [
          { id: 'g-huerfano', summary: 'Vacaciones', start: { dateTime: '2026-12-21T00:00:00-06:00' }, end: { dateTime: '2026-12-24T00:00:00-06:00' } },
          { id: 'g-viejo', summary: 'Vacaciones', start: { dateTime: '2026-12-20T00:00:00-06:00' }, end: { dateTime: '2026-12-24T00:00:00-06:00' } },
        ] } };
      }
      return init.method === 'POST' ? { body: { id: 'g-nuevo' } } : { status: 204 };
    });
    conectar(tokens);
    expect(await svc.reconciliar('ana', [vac], AHORA)).toEqual({ creados: 0, borrados: 0 });
    expect(llamadas.filter(l => l.metodo === 'POST')).toEqual([]);
    expect(llamadas.find(l => l.metodo === 'DELETE')!.url).toContain('/events/g-viejo');
    expect(eventos.get('ana|ausencia:a1')).toMatchObject({ event_id: 'g-huerfano' });
  });

  it('dos sincronizaciones juntas no crean el evento dos veces', async () => {
    let n = 0;
    const { svc, tokens, llamadas } = armar((url, init) => (init.method === 'POST' ? { body: { id: `g${++n}` } } : { status: 204 }));
    conectar(tokens);
    await Promise.all([svc.reconciliar('ana', [vac], AHORA), svc.reconciliar('ana', [vac], AHORA)]);
    expect(llamadas.filter(l => l.metodo === 'POST')).toHaveLength(1);
  });

  it('sin conexión no hace nada', async () => {
    const { svc, llamadas } = armar(() => ({}));
    expect(await svc.reconciliar('ana', [vac], AHORA)).toEqual({ creados: 0, borrados: 0 });
    expect(llamadas).toEqual([]);
  });
});

describe('reuniones de la oficina', () => {
  it('crea el evento con Meet e invitados, guarda el enlace y al terminar lo cierra con la hora real', async () => {
    const { svc, tokens, llamadas } = armar((url, init) =>
      init.method === 'POST' ? { body: { id: 'gm', hangoutLink: 'https://meet.google.com/abc-defg-hij' } } : { body: {} });
    conectar(tokens);
    expect(await svc.crearReunion('ana', 'm1', 'Revisar propuesta', ['bruno@grupovla.com'], AHORA)).toBe('https://meet.google.com/abc-defg-hij');
    const post = llamadas.find(l => l.metodo === 'POST')!;
    expect(post.url).toContain('conferenceDataVersion=1');
    expect(post.cuerpo).toMatchObject({ summary: 'Revisar propuesta', attendees: [{ email: 'bruno@grupovla.com' }] });
    expect((await svc.enlacesDe(['m1'])).get('m1')).toBe('https://meet.google.com/abc-defg-hij');

    // Una reunión que no es esta no la toca.
    await svc.cerrarReuniones('ana', ['otra'], new Date(AHORA.getTime() + 10 * 60_000));
    expect(llamadas.filter(l => l.metodo === 'PATCH')).toHaveLength(0);
    await svc.cerrarReuniones('ana', ['m1'], new Date(AHORA.getTime() + 25 * 60_000));
    const patch = llamadas.find(l => l.metodo === 'PATCH')!;
    expect(patch.cuerpo.end.dateTime).toBe('2026-10-14T16:25:00.000Z');
    // Ya cerrada: no se vuelve a tocar.
    await svc.cerrarReuniones('ana', undefined, new Date(AHORA.getTime() + 40 * 60_000));
    expect(llamadas.filter(l => l.metodo === 'PATCH')).toHaveLength(1);
  });

  it('si Google no la cierra, queda abierta y se reintenta en el próximo cierre con la hora real', async () => {
    let falla = true;
    const { svc, tokens, eventos, llamadas } = armar((url, init) => {
      if (init.method === 'POST') return { body: { id: 'gm', hangoutLink: 'https://meet.google.com/abc-defg-hij' } };
      if (init.method === 'PATCH') return falla ? { status: 500 } : { body: {} };
      return { body: {} };
    });
    conectar(tokens);
    await svc.crearReunion('ana', 'm1', 'Revisar', [], AHORA);
    const finOriginal = eventos.get('ana|reunion:m1').fin;
    await svc.cerrarReuniones('ana', ['m1'], new Date(AHORA.getTime() + 10 * 60_000));
    expect(eventos.get('ana|reunion:m1').fin).toBe(finOriginal);
    falla = false;
    await svc.cerrarReuniones('ana', undefined, new Date(AHORA.getTime() + 12 * 60_000));
    expect(llamadas.filter(l => l.metodo === 'PATCH')).toHaveLength(2);
    // Terminó a las +10, no a las +12 del reintento.
    expect(eventos.get('ana|reunion:m1').fin).toBe('2026-10-14T16:10:00.000Z');
    expect(llamadas.filter(l => l.metodo === 'PATCH').map(l => l.cuerpo.end.dateTime)).toEqual(['2026-10-14T16:10:00.000Z', '2026-10-14T16:10:00.000Z']);
  });

  it('una reunión de más de una hora también se cierra con la hora real', async () => {
    const { svc, tokens, llamadas } = armar((url, init) =>
      init.method === 'POST' ? { body: { id: 'gm', hangoutLink: 'https://meet.google.com/abc-defg-hij' } } : { body: {} });
    conectar(tokens);
    await svc.crearReunion('ana', 'm1', 'Planificación', [], AHORA);
    await svc.cerrarReuniones('ana', undefined, new Date(AHORA.getTime() + 95 * 60_000));
    expect(llamadas.find(l => l.metodo === 'PATCH')!.cuerpo.end.dateTime).toBe('2026-10-14T17:35:00.000Z');
  });

  it('si Google devuelve el Meet pendiente, lo vuelve a pedir', async () => {
    const { svc, tokens } = armar((url, init) => {
      if (init.method === 'POST') return { body: { id: 'gm', conferenceData: { createRequest: { status: { statusCode: 'pending' } } } } };
      if (url.includes('/events/gm')) return { body: { id: 'gm', hangoutLink: 'https://meet.google.com/xyz-abcd-efg' } };
      return { body: {} };
    });
    conectar(tokens);
    expect(await svc.crearReunion('ana', 'm1', 'Revisar', [], AHORA)).toBe('https://meet.google.com/xyz-abcd-efg');
    expect((await svc.enlacesDe(['m1'])).get('m1')).toBe('https://meet.google.com/xyz-abcd-efg');
  });

  it('cerrar espera a la que todavía se está creando', async () => {
    const { svc, tokens, llamadas } = armar((url, init) =>
      init.method === 'POST' ? { body: { id: 'gm', hangoutLink: 'https://meet.google.com/abc-defg-hij' } } : { body: {} });
    conectar(tokens);
    const crear = svc.crearReunion('ana', 'm1', 'Revisar', [], AHORA);
    const cerrar = svc.cerrarReuniones('ana', ['m1'], new Date(AHORA.getTime() + 5 * 60_000));
    await Promise.all([crear, cerrar]);
    expect(llamadas.map(l => l.metodo).filter(m => m !== 'GET')).toEqual(['POST', 'PATCH']);
  });
});

describe('«En reunión» puesto por Google', () => {
  it('soltar lo marca; volver a poner lo limpia', async () => {
    const { svc, estado } = armar(() => ({}));
    await svc.guardarPuesto('ana', { eventId: 'e1', status: 'IN_MEETING_EXTERNAL', titulo: 'Demo' });
    await svc.soltarPuesto('ana');
    expect(await svc.puesto('ana')).toEqual({ eventId: 'e1', status: 'IN_MEETING_EXTERNAL', titulo: 'Demo', soltado: true });
    await svc.guardarPuesto('ana', { eventId: 'e2', status: 'IN_MEETING_INTERNAL', titulo: 'Otra' });
    expect(estado.get('ana')).toMatchObject({ event_id: 'e2', soltado: false });
  });

  it('desconectar no borra lo puesto: así la vuelta de estados la devuelve a Disponible', async () => {
    const { svc, tokens } = armar(() => ({ status: 204 }));
    conectar(tokens);
    await svc.guardarPuesto('ana', { eventId: 'e1', status: 'IN_MEETING_EXTERNAL', titulo: 'Demo' });
    await svc.desconectar('ana');
    expect(tokens.size).toBe(0);
    expect(await svc.puesto('ana')).toMatchObject({ eventId: 'e1' });
    expect(await svc.eventosAhora('ana', AHORA)).toBeNull();
  });
});
