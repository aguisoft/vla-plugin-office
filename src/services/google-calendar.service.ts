import { randomBytes } from 'crypto';
import type { PluginContext } from '@vla/plugin-sdk';
import {
  ALCANCES_GOOGLE, dominioPermitido, firmarEstado, leerEstado, firmaDe, planDeAusencias, ocupadoHasta, coincide,
  type EventoDeseado, type EventoCreado, type EventoGoogle, type Puesto,
} from '../lib/google-calendar';

/**
 * El Google Calendar de cada persona (14-oct-2026): conectar la cuenta con
 * OAuth (como el Gmail de cobros), guardar y renovar sus tokens, y las pocas
 * llamadas a la API de Calendar que usa la oficina. Lo que se decide (qué
 * eventos van, cuándo cambia el estado) está en lib/google-calendar.ts.
 *
 * Sin SDK: fetch directo, igual que cobros. Los tokens son de office y de nadie
 * más (Google rota el de acceso y un segundo dueño los pisaría).
 */

export class ErrorGoogle extends Error {
  constructor(readonly codigo: string, mensaje?: string) { super(mensaje ?? codigo); }
}

/** llaveEstado: solo para las pruebas; en producción la llave del state es al azar por proceso. */
interface Config { clientId: string; clientSecret: string; urlPublica: string; tz: string; llaveEstado?: string }
interface FilaToken { user_id: string; email: string; refresh_token: string; access_token: string | null; expires_at: string | null; conectado_en: string }

const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN = 'https://oauth2.googleapis.com/token';
/** Ninguna llamada a Google espera más que esto (una colgada frenaría la fila de esa persona). */
const ESPERA_MAX_MS = 15_000;

export class GoogleCalendarService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly config: () => Config,
    private readonly http: typeof fetch = fetch,
  ) {}

  /**
   * Lo que escribe en el calendario de una persona va de a uno: dos
   * sincronizaciones juntas crearían el mismo evento dos veces, y cerrar una
   * reunión antes de que termine de crearse la dejaría abierta.
   */
  private readonly filas = new Map<string, Promise<unknown>>();
  private enFila<T>(userId: string, trabajo: () => Promise<T>): Promise<T> {
    const resultado = (this.filas.get(userId) ?? Promise.resolve()).then(trabajo);
    const fin = resultado.catch(() => undefined);
    this.filas.set(userId, fin);
    void fin.then(() => { if (this.filas.get(userId) === fin) this.filas.delete(userId); });
    return resultado;
  }

  /**
   * Con qué se firma el state del enlace para conectar. NO el client secret:
   * la configuración de los módulos la puede leer cualquiera con sesión
   * (GET /api/v1/plugins), y con él se podría firmar un state ajeno. Al azar
   * por proceso: si el API se reinicia en esos 10 minutos, se vuelve a intentar.
   */
  private readonly llaveAlAzar = randomBytes(32).toString('hex');
  private llaveEstado(): string {
    return this.config().llaveEstado || this.llaveAlAzar;
  }

  /** Para esperar a que Google termine de armar el Meet (las pruebas lo cambian). */
  dormir = (ms: number) => new Promise<void>(listo => setTimeout(listo, ms));

  private llamar(url: string, init: RequestInit = {}): Promise<Response> {
    return this.http(url, { ...init, signal: AbortSignal.timeout(ESPERA_MAX_MS) });
  }

  configurado(): boolean {
    const c = this.config();
    return !!c.clientId && !!c.clientSecret;
  }

  private redirect(): string {
    return `${this.config().urlPublica.replace(/\/+$/, '')}/api/v1/p/office/google/callback`;
  }

  // ── Conectar ───────────────────────────────────────────────────────────────

  urlConectar(userId: string, ahora = Date.now()): string {
    const c = this.config();
    if (!this.configurado()) throw new ErrorGoogle('sin_configurar', 'Google Calendar todavía no está configurado');
    const q = new URLSearchParams({
      client_id: c.clientId, redirect_uri: this.redirect(), response_type: 'code', scope: ALCANCES_GOOGLE.join(' '),
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: firmarEstado(userId, ahora, this.llaveEstado()),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }

  /**
   * La vuelta de Google: canjea el código, valida la cuenta y guarda los tokens.
   * `sesion` es quien tiene la sesión de la oficina abierta en ese navegador:
   * tiene que ser quien pidió el enlace. Si no, alguien podría pasarle a otra
   * persona su enlace y quedarse con el calendario de ella.
   */
  async completar(code: string, state: string, sesion: string | null, ahora = Date.now()): Promise<{ userId: string; email: string }> {
    const c = this.config();
    const userId = leerEstado(state, this.llaveEstado(), ahora);
    if (!userId) throw new ErrorGoogle('estado_invalido');
    if (sesion !== userId) throw new ErrorGoogle('sesion');
    if (!code) throw new ErrorGoogle('sin_codigo');
    const t = await this.pedirToken({ code, redirect_uri: this.redirect(), grant_type: 'authorization_code' });
    if (!t.refresh_token) throw new ErrorGoogle('sin_refresh');
    const info = await this.json<{ email?: string; email_verified?: boolean }>(
      await this.llamar('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } }));
    const email = String(info.email ?? '').toLowerCase();
    if (!email || !dominioPermitido(email) || info.email_verified === false) {
      await this.revocar(t.refresh_token);
      throw new ErrorGoogle('dominio', email);
    }
    const permisos = String(t.scope ?? '');
    if (!permisos.includes('calendar.events')) {
      await this.revocar(t.refresh_token);
      throw new ErrorGoogle('sin_permiso');
    }
    // Que la API de Calendar responda de verdad (si no está habilitada en
    // Google Cloud, todo lo demás fallaría en silencio con «conectado»).
    const prueba = await this.llamar(`${API}/calendars/primary/events?maxResults=1`, { headers: { Authorization: `Bearer ${t.access_token}` } });
    if (!prueba.ok) {
      await this.revocar(t.refresh_token);
      throw new ErrorGoogle('api', `Calendar respondió ${prueba.status}`);
    }
    // Otra cuenta: lo que la oficina puso en la anterior se borra y esa se revoca.
    const anterior = await this.emailDe(userId);
    if (anterior && anterior !== email) await this.desconectar(userId);
    await this.ctx.query(
      `INSERT INTO office_google_tokens (user_id, email, refresh_token, access_token, expires_at, scope, conectado_en)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6, now())
       ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, refresh_token = EXCLUDED.refresh_token,
         access_token = EXCLUDED.access_token, expires_at = EXCLUDED.expires_at, scope = EXCLUDED.scope, conectado_en = now()`,
      [userId, email, t.refresh_token, t.access_token, new Date(ahora + (t.expires_in ?? 3600) * 1000).toISOString(), permisos]);
    return { userId, email };
  }

  async estado(userId: string): Promise<{ configurado: boolean; conectado: boolean; email?: string; desde?: string }> {
    const [f] = await this.ctx.query<FilaToken>(`SELECT email, conectado_en::text AS conectado_en FROM office_google_tokens WHERE user_id = $1`, [userId]);
    return f ? { configurado: this.configurado(), conectado: true, email: f.email, desde: f.conectado_en } : { configurado: this.configurado(), conectado: false };
  }

  async conectados(): Promise<string[]> {
    return (await this.ctx.query<{ user_id: string }>(`SELECT user_id FROM office_google_tokens`)).map(f => f.user_id);
  }

  async emailDe(userId: string): Promise<string | null> {
    const [f] = await this.ctx.query<{ email: string }>(`SELECT email FROM office_google_tokens WHERE user_id = $1`, [userId]);
    return f?.email ?? null;
  }

  /** Borra lo que la oficina puso en su calendario de acá en adelante, revoca y olvida. */
  desconectar(userId: string): Promise<void> {
    return this.enFila(userId, async () => {
      const futuros = await this.ctx.query<{ clave: string; event_id: string }>(
        `SELECT clave, event_id FROM office_google_eventos WHERE user_id = $1 AND fin > now() AND clave NOT LIKE 'reunion:%'`, [userId]);
      for (const e of futuros) await this.borrarEvento(userId, e.event_id).catch(() => undefined);
      const [f] = await this.ctx.query<FilaToken>(`SELECT refresh_token FROM office_google_tokens WHERE user_id = $1`, [userId]);
      if (f?.refresh_token) await this.revocar(f.refresh_token);
      await this.olvidar(userId);
    });
  }

  /**
   * Sin tokens ni eventos anotados. El «En reunión» que haya puesto queda
   * anotado a propósito: la vuelta de estados lo ve sin conexión y devuelve a
   * la persona a Disponible (si no, quedaría en reunión para siempre).
   */
  private async olvidar(userId: string): Promise<void> {
    await this.ctx.query(`DELETE FROM office_google_tokens WHERE user_id = $1`, [userId]);
    await this.ctx.query(`DELETE FROM office_google_eventos WHERE user_id = $1`, [userId]);
  }

  // ── Tokens ─────────────────────────────────────────────────────────────────

  private async pedirToken(cuerpo: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }> {
    const c = this.config();
    const r = await this.llamar(TOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...cuerpo, client_id: c.clientId, client_secret: c.clientSecret }),
    });
    const d = await r.json().catch(() => ({})) as any;
    if (!r.ok) throw new ErrorGoogle(d?.error === 'invalid_grant' ? 'revocado' : 'token', String(d?.error_description ?? d?.error ?? r.status));
    return d;
  }

  private async revocar(token: string): Promise<void> {
    await this.llamar(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined);
  }

  /** Un token de acceso vigente, o null si no está conectada (o si revocó el permiso en Google). */
  private async token(userId: string, ahora = Date.now()): Promise<string | null> {
    const [f] = await this.ctx.query<FilaToken>(
      `SELECT user_id, refresh_token, access_token, expires_at::text AS expires_at FROM office_google_tokens WHERE user_id = $1`, [userId]);
    if (!f) return null;
    if (f.access_token && f.expires_at && new Date(f.expires_at).getTime() - ahora > 60_000) return f.access_token;
    try {
      const t = await this.pedirToken({ refresh_token: f.refresh_token, grant_type: 'refresh_token' });
      await this.ctx.query(`UPDATE office_google_tokens SET access_token = $2, expires_at = $3::timestamptz WHERE user_id = $1`,
        [userId, t.access_token, new Date(ahora + (t.expires_in ?? 3600) * 1000).toISOString()]);
      return t.access_token;
    } catch (e) {
      if (e instanceof ErrorGoogle && e.codigo === 'revocado') {
        this.ctx.logger.warn(`Google Calendar: ${userId} revocó el permiso; se desconecta`);
        await this.olvidar(userId);
        return null;
      }
      throw e;
    }
  }

  private async json<T>(r: Response): Promise<T> {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new ErrorGoogle(`http_${r.status}`, JSON.stringify((d as any)?.error ?? d).slice(0, 300));
    return d as T;
  }

  /** Una llamada a la API de Calendar como esa persona. null si no está conectada. */
  private async api<T>(userId: string, metodo: string, ruta: string, cuerpo?: unknown): Promise<T | null> {
    const t = await this.token(userId);
    if (!t) return null;
    const r = await this.llamar(`${API}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${t}`, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    if (metodo === 'DELETE' && (r.status === 204 || r.status === 404 || r.status === 410)) return {} as T;
    return this.json<T>(r);
  }

  // ── Ausencias y feriados → «Fuera de la oficina» ───────────────────────────

  private async creados(userId: string): Promise<EventoCreado[]> {
    return (await this.ctx.query<{ clave: string; event_id: string; firma: string; fin: string }>(
      `SELECT clave, event_id, firma, fin::text AS fin FROM office_google_eventos WHERE user_id = $1`, [userId]))
      .map(f => ({ clave: f.clave, eventId: f.event_id, firma: f.firma, fin: new Date(f.fin).toISOString() }));
  }

  private async borrarEvento(userId: string, eventId: string): Promise<void> {
    await this.api(userId, 'DELETE', `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=none`);
  }

  private async crearFueraDeOficina(userId: string, e: EventoDeseado): Promise<string | null> {
    const tz = this.config().tz;
    const base = {
      summary: e.titulo,
      start: { dateTime: e.inicio, timeZone: tz },
      end: { dateTime: e.fin, timeZone: tz },
      visibility: e.privado ? 'private' : 'default',
      transparency: 'opaque',
      extendedProperties: { private: { vlaOficina: e.clave } },
    };
    try {
      const r = await this.api<{ id: string }>(userId, 'POST', '/calendars/primary/events?sendUpdates=none', {
        ...base, eventType: 'outOfOffice',
        outOfOfficeProperties: { autoDeclineMode: 'declineOnlyNewConflictingInvitations', declineMessage: 'Estoy fuera de la oficina.' },
      });
      return r?.id ?? null;
    } catch (err) {
      // «Fuera de la oficina» es de Workspace y del calendario principal: si
      // Google no lo acepta, va como evento común que marca ocupado.
      if (err instanceof ErrorGoogle && err.codigo === 'http_400') {
        const r = await this.api<{ id: string }>(userId, 'POST', '/calendars/primary/events?sendUpdates=none', base);
        return r?.id ?? null;
      }
      throw err;
    }
  }

  /**
   * Los que la oficina ya dejó en su calendario con esa clave. Se mira antes de
   * crear porque Google pudo haberlo creado sin que la respuesta llegara (o sin
   * que se anotara): crearlo de nuevo lo duplicaría.
   */
  private async buscarPorClave(userId: string, clave: string): Promise<EventoGoogle[]> {
    const q = new URLSearchParams({ privateExtendedProperty: `vlaOficina=${clave}`, singleEvents: 'true', maxResults: '10' });
    return (await this.api<{ items?: EventoGoogle[] }>(userId, 'GET', `/calendars/primary/events?${q}`))?.items ?? [];
  }

  /** Deja en Google exactamente lo que tiene que haber (ver planDeAusencias). */
  reconciliar(userId: string, deseados: EventoDeseado[], ahora = new Date()): Promise<{ creados: number; borrados: number }> {
    return this.enFila(userId, async () => {
      const plan = planDeAusencias(deseados, await this.creados(userId), ahora);
      for (const b of plan.borrar) {
        await this.borrarEvento(userId, b.eventId);
        await this.ctx.query(`DELETE FROM office_google_eventos WHERE user_id = $1 AND clave = $2`, [userId, b.clave]);
      }
      let creados = 0;
      for (const e of plan.crear) {
        const previos = await this.buscarPorClave(userId, e.clave);
        const igual = previos.find(p => coincide(p, e));
        for (const p of previos) if (p !== igual) await this.borrarEvento(userId, p.id);
        const id = igual?.id ?? await this.crearFueraDeOficina(userId, e);
        if (!id) return { creados, borrados: plan.borrar.length };   // se desconectó a mitad de camino
        await this.ctx.query(
          `INSERT INTO office_google_eventos (user_id, clave, event_id, firma, inicio, fin) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
           ON CONFLICT (user_id, clave) DO UPDATE SET event_id = EXCLUDED.event_id, firma = EXCLUDED.firma, inicio = EXCLUDED.inicio, fin = EXCLUDED.fin`,
          [userId, e.clave, id, firmaDe(e), e.inicio, e.fin]);
        if (!igual) creados++;
      }
      return { creados, borrados: plan.borrar.length };
    });
  }

  // ── Reuniones de Google → estado ───────────────────────────────────────────

  /** Lo que tiene en Google en este minuto (null si no está conectada). */
  async eventosAhora(userId: string, ahora = new Date()): Promise<EventoGoogle[] | null> {
    const q = new URLSearchParams({
      timeMin: ahora.toISOString(), timeMax: new Date(ahora.getTime() + 60_000).toISOString(),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '20',
    });
    const r = await this.api<{ items?: EventoGoogle[] }>(userId, 'GET', `/calendars/primary/events?${q}`);
    return r ? r.items ?? [] : null;
  }

  async puesto(userId: string): Promise<Puesto | null> {
    const [f] = await this.ctx.query<{ event_id: string; status: string; titulo: string; soltado: boolean }>(
      `SELECT event_id, status, titulo, soltado FROM office_google_estado WHERE user_id = $1`, [userId]);
    return f ? { eventId: f.event_id, status: f.status, titulo: f.titulo, soltado: !!f.soltado } : null;
  }

  async guardarPuesto(userId: string, p: Omit<Puesto, 'soltado'>): Promise<void> {
    await this.ctx.query(
      `INSERT INTO office_google_estado (user_id, event_id, status, titulo, soltado, puesto_en) VALUES ($1, $2, $3, $4, false, now())
       ON CONFLICT (user_id) DO UPDATE SET event_id = EXCLUDED.event_id, status = EXCLUDED.status, titulo = EXCLUDED.titulo, soltado = false, puesto_en = now()`,
      [userId, p.eventId, p.status, p.titulo]);
  }

  /** La persona cambió el estado a mano: esa reunión no se le vuelve a poner. */
  async soltarPuesto(userId: string): Promise<void> {
    await this.ctx.query(`UPDATE office_google_estado SET soltado = true WHERE user_id = $1`, [userId]);
  }

  async borrarPuesto(userId: string): Promise<void> {
    await this.ctx.query(`DELETE FROM office_google_estado WHERE user_id = $1`, [userId]);
  }

  async conPuesto(): Promise<string[]> {
    return (await this.ctx.query<{ user_id: string }>(`SELECT user_id FROM office_google_estado`)).map(f => f.user_id);
  }

  // ── Ocupado al invitar ─────────────────────────────────────────────────────

  async ocupadoHasta(userId: string, ahora = new Date()): Promise<Date | null> {
    const r = await this.api<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> }>(userId, 'POST', '/freeBusy', {
      timeMin: ahora.toISOString(), timeMax: new Date(ahora.getTime() + 8 * 3600_000).toISOString(), items: [{ id: 'primary' }],
    });
    return r ? ocupadoHasta(r.calendars?.primary?.busy ?? [], ahora) : null;
  }

  // ── Reuniones de la oficina → Google, con Meet ─────────────────────────────

  /** El evento en el calendario de quien la arma, con Meet y los invitados. */
  crearReunion(hostId: string, meetingId: string, titulo: string, invitados: string[], ahora = new Date()): Promise<string | null> {
    return this.enFila(hostId, async () => {
      const tz = this.config().tz;
      const fin = new Date(ahora.getTime() + 60 * 60_000);
      const r = await this.api<{ id: string; hangoutLink?: string }>(hostId, 'POST', '/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none', {
        summary: titulo || 'Reunión',
        description: 'Reunión armada en la Oficina Virtual de VLA.',
        start: { dateTime: ahora.toISOString(), timeZone: tz },
        end: { dateTime: fin.toISOString(), timeZone: tz },
        attendees: invitados.map(email => ({ email })),
        conferenceData: { createRequest: { requestId: meetingId, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
        extendedProperties: { private: { vlaOficina: `reunion:${meetingId}` } },
      });
      if (!r) return null;
      let enlace = r.hangoutLink ?? null;
      if (!enlace) {
        // Google puede devolver el Meet «pendiente»: se pregunta una vez más.
        await this.dormir(1500);
        const otra = await this.api<{ hangoutLink?: string }>(hostId, 'GET', `/calendars/primary/events/${encodeURIComponent(r.id)}`).catch(() => null);
        enlace = otra?.hangoutLink ?? null;
      }
      await this.ctx.query(
        `INSERT INTO office_google_eventos (user_id, clave, event_id, firma, inicio, fin, enlace) VALUES ($1, $2, $3, '', $4::timestamptz, $5::timestamptz, $6)
         ON CONFLICT (user_id, clave) DO NOTHING`,
        [hostId, `reunion:${meetingId}`, r.id, ahora.toISOString(), fin.toISOString(), enlace]);
      return enlace;
    });
  }

  /**
   * Cierra con la hora real las reuniones de la oficina que esa persona tenía
   * abiertas (todas, o solo las de `meetingIds`). Va en la misma fila que
   * crearReunion: una que todavía se está creando se cierra cuando termina.
   * Si Google no responde, queda abierta y se reintenta en el próximo cierre.
   * Se mira `cerrada` y no el fin: una reunión de más de una hora (el fin con
   * que se crea) también se cierra con la hora real. Solo las del último día.
   */
  cerrarReuniones(hostId: string, meetingIds?: string[], ahora?: Date): Promise<void> {
    const solo = meetingIds ? new Set(meetingIds.map(id => `reunion:${id}`)) : null;
    if (solo && !solo.size) return Promise.resolve();
    return this.enFila(hostId, async () => {
      const momento = ahora ?? new Date();
      const abiertas = (await this.ctx.query<{ clave: string; event_id: string; inicio: string }>(
        `SELECT clave, event_id, inicio::text AS inicio FROM office_google_eventos
          WHERE user_id = $1 AND clave LIKE 'reunion:%' AND NOT cerrada AND inicio > $2::timestamptz`,
        [hostId, new Date(momento.getTime() - 86_400_000).toISOString()])).filter(a => !solo || solo.has(a.clave));
      for (const a of abiertas) {
        const fin = new Date(Math.max(momento.getTime(), new Date(a.inicio).getTime() + 60_000));
        try {
          await this.api(hostId, 'PATCH', `/calendars/primary/events/${encodeURIComponent(a.event_id)}?sendUpdates=none`,
            { end: { dateTime: fin.toISOString(), timeZone: this.config().tz } });
        } catch (e) {
          // Borrada en Google: no hay nada que cerrar.
          const yaNoEsta = e instanceof ErrorGoogle && (e.codigo === 'http_404' || e.codigo === 'http_410');
          if (!yaNoEsta) { this.ctx.logger.warn(`Google Calendar: no se cerró la reunión ${a.clave}: ${e}`); continue; }
        }
        await this.ctx.query(`UPDATE office_google_eventos SET fin = $3::timestamptz, cerrada = true WHERE user_id = $1 AND clave = $2`, [hostId, a.clave, fin.toISOString()]);
      }
    });
  }

  /** El enlace de Meet de una reunión de la oficina, si se creó en Google. */
  async enlacesDe(meetingIds: string[]): Promise<Map<string, string>> {
    if (!meetingIds.length) return new Map();
    const filas = await this.ctx.query<{ clave: string; enlace: string }>(
      `SELECT clave, enlace FROM office_google_eventos WHERE enlace IS NOT NULL AND clave IN (${meetingIds.map((_, i) => `$${i + 1}`).join(', ')})`,
      meetingIds.map(id => `reunion:${id}`));
    return new Map(filas.map(f => [f.clave.slice('reunion:'.length), f.enlace]));
  }
}
