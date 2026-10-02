import type { PluginContext } from '@vla/plugin-sdk';
import type { BitrixUserService } from './bitrix-user.service';
import {
  decidirAviso, registrarAvisoInmediato, saltosTrasFallos, totalSinLeer, vistaPrevia,
} from '../lib/im-aviso';
import { urlDeBitrix } from '../lib/im-chat';
import { chatIdDe, destinatariosDeGrupo, novedades, textoNovedades } from '../lib/im-grupos';
import { unirRecientes, completarSinLeer, idsSinLeerFaltantes, cuentaActiva, ajustarContadores } from '../lib/im-recientes';

/** La persona no conectó su Bitrix (o lo revocó). Las rutas lo traducen a 409. */
export class SinBitrixError extends Error {
  constructor() {
    super('Conectá tu Bitrix para usar la mensajería');
  }
}

/** Lo que la mensajería necesita de PresenceService, sin depender de toda la clase. */
export interface Avisador {
  broadcastToUser(userId: string, payload: object): void;
  /** Usuarios con al menos una conexión SSE viva (widget u oficina abierta). */
  conectados(): string[];
}

interface EstadoConsulta {
  base: number | null;
  fallos: number;
  saltar: number;
  /** Contadores por chat y diálogo de la lectura anterior: para decir de dónde vienen los mensajes. */
  previo?: { CHAT?: Record<string, number>; DIALOG?: Record<string, number> } | null;
}

/** Lo que el widget necesita de un grupo. */
export interface InfoGrupo {
  chatId: number;
  titulo: string;
  duenoId: string | null;
  adminIds: string[];
  muteList: unknown;
  miembros: string[];
}

const URL_OFICINA = '/dashboard/office';

/**
 * Mensajería de Bitrix hablando COMO cada persona: todo pasa por su propio
 * token, nunca por el global de la app (que es de Carlos y firmaría todo).
 */
export class MensajeriaService {
  private estados = new Map<string, EstadoConsulta>();
  /** Si cada usuario de Bitrix está activo. Cambia muy de vez en cuando: 6 h. */
  private activos = new Map<string, { activo: boolean; hasta: number }>();
  private static readonly VIGENCIA_ACTIVOS_MS = 6 * 60 * 60 * 1000;
  /**
   * Datos de cada grupo (nombre, dueño, silencios, miembros) por un minuto: el
   * aviso inmediato los necesita en cada mensaje y no vale la pena preguntarle a
   * Bitrix dos veces por mensaje.
   */
  private grupos = new Map<number, { info: InfoGrupo; hasta: number }>();
  /** Nombres de grupos para los avisos de respaldo: cambian poco, 1 h. */
  private titulos = new Map<string, { titulo: string; hasta: number }>();
  private enCurso = false;

  constructor(
    private readonly ctx: PluginContext,
    private readonly tokens: BitrixUserService,
    private readonly avisador: Avisador,
    /** Pausa entre personas en la consulta de respaldo. Inyectable para las pruebas. */
    private readonly pausa: () => Promise<void> = () => new Promise(r => setTimeout(r, 400)),
  ) {}

  async llamar<T = any>(userId: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.ctx.bitrix) throw new Error('Bitrix no está configurado en el sistema');
    const token = await this.tokens.obtenerVigente(userId);
    if (!token) throw new SinBitrixError();
    return this.ctx.bitrix.callAsUser<T>(token, method, params);
  }

  /**
   * Diálogos y chats por separado (de a uno, nunca en paralelo: el portal tiene
   * ~2 llamadas/s) y sin chats de tareas, que llenaban la lista. Ver im-recientes.ts.
   */
  async recientes(userId: string) {
    const dialogos = await this.llamar(userId, 'im.recent.get', { SKIP_OPENLINES: 'Y', SKIP_CHAT: 'Y' });
    const chats = await this.llamar(userId, 'im.recent.get', { SKIP_OPENLINES: 'Y', SKIP_DIALOG: 'Y' });
    const base = unirRecientes(dialogos, chats);

    // Diálogos sin leer que Bitrix no listó (ocultos de recientes). Si esto
    // falla, la lista de arriba igual sirve: no se pierde lo que ya había.
    try {
      const contadores = await this.contadores(userId);
      const faltan = idsSinLeerFaltantes(base, contadores);
      if (!faltan.length) return base;
      const usuarios = await this.llamar(userId, 'im.user.list.get', { ID: faltan }).catch(() => null);
      return completarSinLeer(base, contadores, usuarios);
    } catch (e) {
      if (e instanceof SinBitrixError) throw e;
      this.ctx.logger.warn(`No se pudieron completar los diálogos sin leer: ${e}`);
      return base;
    }
  }

  /**
   * `im.counters.get` sin los diálogos de cuentas desactivadas en Bitrix (ver
   * `ajustarContadores`). De acá salen el número del widget, la lista de
   * recientes completada y la consulta de respaldo de avisos.
   */
  async contadores(userId: string, ahora = Date.now()) {
    const crudo = await this.llamar<any>(userId, 'im.counters.get');
    const ids = Object.entries(crudo?.DIALOG ?? {}).filter(([, n]) => Number(n) > 0).map(([id]) => id);
    const desconocidos = ids.filter(id => /^\d+$/.test(id) && !((this.activos.get(id)?.hasta ?? 0) > ahora));
    if (desconocidos.length) {
      try {
        const usuarios = await this.llamar<Record<string, any>>(userId, 'im.user.list.get', { ID: desconocidos.slice(0, 50).map(Number) });
        for (const id of desconocidos.slice(0, 50)) {
          this.activos.set(id, { activo: cuentaActiva(usuarios?.[id]), hasta: ahora + MensajeriaService.VIGENCIA_ACTIVOS_MS });
        }
      } catch (e) {
        if (e instanceof SinBitrixError) throw e;
        // Sin saberlo, mejor mostrar de más que esconder un mensaje real.
        this.ctx.logger.warn(`No se pudo saber qué cuentas de Bitrix están activas: ${e}`);
      }
    }
    return ajustarContadores(crudo, id => this.activos.get(id)?.activo ?? true);
  }

  dialogo(userId: string, dialogId: string) {
    return this.llamar(userId, 'im.dialog.messages.get', { DIALOG_ID: dialogId, LIMIT: 30 });
  }

  marcarLeido(userId: string, dialogId: string) {
    return this.llamar(userId, 'im.dialog.read', { DIALOG_ID: dialogId });
  }

  /**
   * Manda el mensaje y, si el destinatario es del equipo, le avisa en el acto.
   * El aviso no forma parte de la respuesta: si falla, el mensaje igual salió.
   */
  /**
   * El hilo con reacciones, archivos y respuestas: `im.v2.Chat.Message.list`
   * trae todo junto (la API clásica no trae las reacciones que no son 👍).
   */
  hilo(userId: string, dialogId: string) {
    return this.llamar(userId, 'im.v2.Chat.Message.list', { dialogId, limit: 50 });
  }

  borrar(userId: string, mensajeId: number) {
    return this.llamar(userId, 'im.message.delete', { ID: mensajeId });
  }

  reaccionar(userId: string, mensajeId: number, reaccion: string, quitar: boolean) {
    return this.llamar(userId, quitar ? 'im.v2.Chat.Message.Reaction.delete' : 'im.v2.Chat.Message.Reaction.add', { messageId: mensajeId, reaction: reaccion });
  }

  /**
   * Sube un archivo al chat: carpeta del chat en el Disco de Bitrix, subida en
   * base64 y publicación en el chat. Avisa al destinatario como un mensaje más.
   */
  async enviarArchivo(userId: string, dialogId: string, nombre: string, base64: string, texto?: string): Promise<{ id: number }> {
    const dialogo = await this.llamar<any>(userId, 'im.dialog.get', { DIALOG_ID: dialogId });
    const chatId = Number(dialogo?.id);
    if (!chatId) throw new Error('[im.dialog.get] sin id de chat');
    const carpeta = await this.llamar<any>(userId, 'im.disk.folder.get', { CHAT_ID: chatId });
    const subido = await this.llamar<any>(userId, 'disk.folder.uploadfile', {
      id: carpeta?.ID, data: { NAME: nombre }, fileContent: [nombre, base64], generateUniqueName: true,
    });
    const r = await this.llamar<any>(userId, 'im.disk.file.commit', { CHAT_ID: chatId, FILE_ID: subido?.ID, ...(texto ? { MESSAGE: texto } : {}) });
    try {
      await this.avisarInmediato(userId, dialogId, texto ? `📎 ${texto}` : `📎 ${nombre}`);
    } catch (e) {
      this.ctx.logger.warn(`Aviso inmediato de archivo falló: ${e}`);
    }
    return { id: Number(r?.MESSAGE_ID) || 0 };
  }

  /**
   * Un archivo de Bitrix para mostrarlo o bajarlo. Las URLs que trae el chat
   * piden la sesión de Bitrix del navegador; `disk.file.get` da una URL de
   * descarga firmada para el token de quien pregunta (Bitrix controla el acceso).
   */
  async archivo(userId: string, fileId: number): Promise<{ nombre: string; respuesta: Response }> {
    const f = await this.llamar<any>(userId, 'disk.file.get', { id: fileId });
    if (!f?.DOWNLOAD_URL) throw new Error('[disk.file.get] sin URL de descarga');
    // La URL de descarga también pide el token (sin él, 401: visto el 1-oct-2026).
    // Solo se le agrega si apunta al portal de Bitrix: el token no sale a otro dominio.
    if (!urlDeBitrix(f.DOWNLOAD_URL)) throw new Error('[disk.file.get] URL de descarga fuera del portal');
    const token = await this.tokens.obtenerVigente(userId);
    if (!token) throw new SinBitrixError();
    const original = new URL(f.DOWNLOAD_URL);
    // Dos formas de autenticar la descarga; se prueba en orden y se registra (sin el
    // token) qué contestó Bitrix, porque el 1-oct-2026 la URL sola daba 401.
    const intentos: Array<{ nombre: string; url: URL; headers: Record<string, string> }> = [
      { nombre: 'bearer', url: original, headers: { Authorization: `Bearer ${token}` } },
      { nombre: 'auth', url: (() => { const u = new URL(original); u.searchParams.set('auth', token); return u; })(), headers: {} },
    ];
    let ultimo = 0;
    for (const i of intentos) {
      const respuesta = await fetch(i.url, { headers: i.headers });
      if (respuesta.ok && respuesta.body) return { nombre: String(f.NAME ?? 'archivo'), respuesta };
      ultimo = respuesta.status;
      const cuerpo = (await respuesta.text().catch(() => '')).replace(/[A-Za-z0-9]{32,}/g, '<largo>').slice(0, 160);
      this.ctx.logger.warn(`Descarga de Bitrix (${i.nombre}) dio ${respuesta.status}; parámetros de la URL: ${[...original.searchParams.keys()].join(',')}; respuesta: ${cuerpo}`);
    }
    throw new Error(`[disk.file.get] descarga ${ultimo}`);
  }

  async infoGrupo(userId: string, dialogId: string, ahora = Date.now()): Promise<InfoGrupo> {
    const chatId = chatIdDe(dialogId);
    if (!chatId) throw new Error('[im.dialog.get] no es un grupo');
    const c = this.grupos.get(chatId);
    if (c && c.hasta > ahora) return c.info;
    const d = await this.llamar<any>(userId, 'im.dialog.get', { DIALOG_ID: dialogId });
    const ids = await this.llamar<any>(userId, 'im.chat.user.list', { CHAT_ID: chatId });
    const info: InfoGrupo = {
      chatId,
      titulo: String(d?.name ?? 'Grupo'),
      duenoId: d?.owner != null ? String(d.owner) : null,
      adminIds: Array.isArray(d?.manager_list) ? d.manager_list.map(String) : [],
      muteList: d?.mute_list ?? [],
      miembros: Array.isArray(ids) ? ids.map(String) : [],
    };
    this.grupos.set(chatId, { info, hasta: ahora + 60_000 });
    this.titulos.set(String(chatId), { titulo: info.titulo, hasta: ahora + 3_600_000 });
    return info;
  }

  private olvidarGrupo(dialogId: string) {
    const id = chatIdDe(dialogId);
    if (id) this.grupos.delete(id);
  }

  /** Nombres de los miembros que no son del equipo (el equipo los pone office). */
  nombresDeBitrix(userId: string, ids: number[]) {
    return ids.length ? this.llamar<Record<string, any>>(userId, 'im.user.list.get', { ID: ids.slice(0, 50) }) : Promise.resolve({});
  }

  async silenciar(userId: string, dialogId: string, silenciar: boolean) {
    const r = await this.llamar(userId, 'im.chat.mute', { CHAT_ID: chatIdDe(dialogId), ACTION: silenciar ? 'Y' : 'N' });
    this.olvidarGrupo(dialogId);
    return r;
  }

  async crearGrupo(userId: string, titulo: string, miembros: number[]): Promise<{ dialogId: string }> {
    const id = await this.llamar<number>(userId, 'im.chat.add', { TYPE: 'CHAT', TITLE: titulo, USERS: miembros });
    if (!Number(id)) throw new Error('[im.chat.add] sin id de chat');
    return { dialogId: `chat${Number(id)}` };
  }

  async agregarMiembros(userId: string, dialogId: string, miembros: number[]) {
    const r = await this.llamar(userId, 'im.chat.user.add', { CHAT_ID: chatIdDe(dialogId), USERS: miembros });
    this.olvidarGrupo(dialogId);
    return r;
  }

  async quitarMiembro(userId: string, dialogId: string, bitrixUserId: number) {
    const r = await this.llamar(userId, 'im.chat.user.delete', { CHAT_ID: chatIdDe(dialogId), USER_ID: bitrixUserId });
    this.olvidarGrupo(dialogId);
    return r;
  }

  async salirGrupo(userId: string, dialogId: string) {
    const r = await this.llamar(userId, 'im.chat.leave', { CHAT_ID: chatIdDe(dialogId) });
    this.olvidarGrupo(dialogId);
    return r;
  }

  async renombrarGrupo(userId: string, dialogId: string, titulo: string) {
    const r = await this.llamar(userId, 'im.chat.updateTitle', { CHAT_ID: chatIdDe(dialogId), TITLE: titulo });
    this.olvidarGrupo(dialogId);
    return r;
  }

  async enviar(userId: string, dialogId: string, texto: string, replyId?: number): Promise<{ id: number }> {
    // Responder enlazado solo existe en la API v2 (el REPLY_ID de im.message.add se ignora).
    const id = replyId
      ? Number((await this.llamar<any>(userId, 'im.v2.Chat.Message.send', { dialogId, fields: { message: texto, replyId } }))?.id) || 0
      : await this.llamar<number>(userId, 'im.message.add', { DIALOG_ID: dialogId, MESSAGE: texto });
    try {
      await this.avisarInmediato(userId, dialogId, texto);
    } catch (e) {
      this.ctx.logger.warn(`Aviso inmediato de mensaje falló: ${e}`);
    }
    return { id };
  }

  private async avisarInmediato(remitenteId: string, dialogId: string, texto: string): Promise<void> {
    if (chatIdDe(dialogId)) return this.avisarGrupo(remitenteId, dialogId, texto);
    if (!/^\d+$/.test(dialogId)) return;
    const destino = await this.ctx.prisma.bitrixUserMapping.findFirst({ where: { bitrixUserId: Number(dialogId) } });
    if (!destino || destino.userId === remitenteId) return;

    const [remitente, mapeoRemitente] = await Promise.all([
      this.ctx.prisma.user.findUnique({ where: { id: remitenteId }, select: { firstName: true, lastName: true } }),
      this.ctx.prisma.bitrixUserMapping.findFirst({ where: { userId: remitenteId } }),
    ]);
    const nombre = remitente ? `${remitente.firstName} ${remitente.lastName}`.trim() : 'Alguien';
    const preview = vistaPrevia(texto);

    this.avisador.broadcastToUser(destino.userId, {
      type: 'im:new',
      // Para responder, el destinatario abre el diálogo con el usuario de Bitrix del remitente.
      dialogId: mapeoRemitente ? String(mapeoRemitente.bitrixUserId) : null,
      de: nombre,
      preview,
    });
    await this.ctx.hooks.doAction('core.push.send', {
      userId: destino.userId, title: `${nombre} te escribió`, body: preview, url: URL_OFICINA,
    });

    const estado = this.estados.get(destino.userId);
    if (estado) estado.base = registrarAvisoInmediato(estado.base);
  }

  /**
   * Un mensaje de grupo que salió por el proxy: aviso a cada miembro del equipo
   * (menos quien escribió y quien silenció el grupo, salvo que lo mencionen).
   */
  private async avisarGrupo(remitenteId: string, dialogId: string, texto: string): Promise<void> {
    const info = await this.infoGrupo(remitenteId, dialogId);
    const mapeos = await this.ctx.prisma.bitrixUserMapping.findMany({ select: { userId: true, bitrixUserId: true } });
    const vlaPorBitrix = new Map((mapeos as any[]).map(m => [String(m.bitrixUserId), m.userId as string]));
    const destinos = destinatariosDeGrupo(info.miembros, vlaPorBitrix, remitenteId, info.muteList, texto);
    if (!destinos.length) return;
    const remitente = await this.ctx.prisma.user.findUnique({ where: { id: remitenteId }, select: { firstName: true, lastName: true } });
    const nombre = remitente ? `${remitente.firstName} ${remitente.lastName}`.trim() : 'Alguien';
    const preview = vistaPrevia(texto);
    for (const d of destinos) {
      this.avisador.broadcastToUser(d.userId, { type: 'im:new', dialogId, de: nombre, grupo: info.titulo, mencion: d.mencion, preview });
      await this.ctx.hooks.doAction('core.push.send', {
        userId: d.userId,
        title: d.mencion ? `${nombre} te mencionó en ${info.titulo}` : `${nombre} en ${info.titulo}`,
        body: preview,
        url: URL_OFICINA,
      });
      const estado = this.estados.get(d.userId);
      if (estado) estado.base = registrarAvisoInmediato(estado.base);
    }
  }

  /** «Te agregó al grupo»: a los del equipo que se suman (menos quien los agrega). */
  async avisarAgregados(remitenteId: string, dialogId: string, titulo: string, bitrixIds: number[]): Promise<void> {
    if (!bitrixIds.length) return;
    const mapeos = await this.ctx.prisma.bitrixUserMapping.findMany({ select: { userId: true, bitrixUserId: true } });
    const ids = new Set(bitrixIds.map(String));
    const destinos = (mapeos as any[]).filter(m => ids.has(String(m.bitrixUserId)) && m.userId !== remitenteId).map(m => m.userId as string);
    if (!destinos.length) return;
    const r = await this.ctx.prisma.user.findUnique({ where: { id: remitenteId }, select: { firstName: true, lastName: true } });
    const nombre = r ? `${r.firstName} ${r.lastName}`.trim() : 'Alguien';
    for (const userId of destinos) {
      this.avisador.broadcastToUser(userId, { type: 'im:new', dialogId, de: nombre, grupo: titulo, mencion: false, preview: `Te agregó al grupo «${titulo}»` });
      await this.ctx.hooks.doAction('core.push.send', { userId, title: `${nombre} te agregó a ${titulo}`, body: 'Abrí VLA Oficina para verlo', url: URL_OFICINA });
    }
  }

  /** Nombre de un grupo para el aviso de respaldo (de la caché o preguntándole a Bitrix). */
  private async tituloDe(userId: string, chatId: string, ahora = Date.now()): Promise<string | null> {
    const c = this.titulos.get(chatId);
    if (c && c.hasta > ahora) return c.titulo;
    try {
      const d = await this.llamar<any>(userId, 'im.dialog.get', { DIALOG_ID: `chat${chatId}` });
      const titulo = d?.name ? String(d.name) : null;
      if (titulo) this.titulos.set(chatId, { titulo, hasta: ahora + 3_600_000 });
      return titulo;
    } catch {
      return null;
    }
  }

  /**
   * Consulta de respaldo (cron cada 2 min): lo que no pasó por el proxy.
   * De a una persona, con pausa, y frenando ante el límite de Bitrix: el
   * portal tiene ~2 llamadas/s compartidas con cobros.
   */
  async consultarRespaldo(): Promise<void> {
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      const conTokens = new Set(await this.tokens.conectados());
      const personas = [...new Set(this.avisador.conectados())].filter(u => conTokens.has(u));

      // Quien se fue vuelve a fijar la base en silencio al reconectarse.
      for (const u of this.estados.keys()) if (!personas.includes(u)) this.estados.delete(u);

      for (let i = 0; i < personas.length; i++) {
        const userId = personas[i];
        const estado = this.estados.get(userId) ?? { base: null, fallos: 0, saltar: 0 };
        this.estados.set(userId, estado);
        if (estado.saltar > 0) { estado.saltar--; continue; }

        try {
          const c = await this.contadores(userId);
          const total = totalSinLeer(c);
          estado.fallos = 0;
          if (total !== null) {
            const d = decidirAviso(estado.base, total);
            const n = novedades(estado.previo ?? null, c);
            estado.base = d.base;
            estado.previo = { CHAT: { ...(c?.CHAT ?? {}) }, DIALOG: { ...(c?.DIALOG ?? {}) } };
            if (d.avisar) {
              // A lo sumo 3 nombres nuevos por aviso: cada uno es una llamada a Bitrix.
              const nombres = new Map<string, string | null>();
              for (const id of n.chats.slice(0, 3)) nombres.set(id, await this.tituloDe(userId, id));
              this.avisarRespaldo(userId, d.nuevos, textoNovedades(n, id => nombres.get(id) ?? null, d.nuevos));
            }
          }
        } catch (e) {
          if (e instanceof SinBitrixError) { this.estados.delete(userId); continue; }
          estado.fallos++;
          estado.saltar = saltosTrasFallos(estado.fallos);
          this.ctx.logger.warn(`Consulta de mensajes de ${userId} falló (${estado.fallos} seguidos): ${e}`);
          // El límite es del portal entero: seguir con los demás lo empeora.
          if (/QUERY_LIMIT_EXCEEDED|OVERLOAD/i.test(String(e))) break;
        }
        if (i < personas.length - 1) await this.pausa();
      }
    } finally {
      this.enCurso = false;
    }
  }

  private avisarRespaldo(userId: string, nuevos: number, detalle?: string): void {
    this.avisador.broadcastToUser(userId, { type: 'im:new', nuevos, ...(detalle ? { detalle } : {}) });
    const body = detalle ?? (nuevos === 1 ? 'Tenés 1 mensaje nuevo sin leer' : `Tenés ${nuevos} mensajes nuevos sin leer`);
    void this.ctx.hooks.doAction('core.push.send', { userId, title: 'Mensajes nuevos en Bitrix', body, url: URL_OFICINA })
      .catch(e => this.ctx.logger.warn(`Push de mensajes nuevos falló: ${e}`));
  }
}
