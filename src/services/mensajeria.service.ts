import type { PluginContext } from '@vla/plugin-sdk';
import type { BitrixUserService } from './bitrix-user.service';
import {
  decidirAviso, registrarAvisoInmediato, saltosTrasFallos, totalSinLeer, vistaPrevia,
} from '../lib/im-aviso';
import { unirRecientes, completarSinLeer, idsSinLeerFaltantes } from '../lib/im-recientes';

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
}

const URL_OFICINA = '/dashboard/office';

/**
 * Mensajería de Bitrix hablando COMO cada persona: todo pasa por su propio
 * token, nunca por el global de la app (que es de Carlos y firmaría todo).
 */
export class MensajeriaService {
  private estados = new Map<string, EstadoConsulta>();
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

  contadores(userId: string) {
    return this.llamar(userId, 'im.counters.get');
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
  async enviar(userId: string, dialogId: string, texto: string): Promise<{ id: number }> {
    const id = await this.llamar<number>(userId, 'im.message.add', { DIALOG_ID: dialogId, MESSAGE: texto });
    try {
      await this.avisarInmediato(userId, dialogId, texto);
    } catch (e) {
      this.ctx.logger.warn(`Aviso inmediato de mensaje falló: ${e}`);
    }
    return { id };
  }

  private async avisarInmediato(remitenteId: string, dialogId: string, texto: string): Promise<void> {
    // Solo mensajes directos: un chat grupal no dice a quién avisar.
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
          const total = totalSinLeer(await this.contadores(userId));
          estado.fallos = 0;
          if (total !== null) {
            const d = decidirAviso(estado.base, total);
            estado.base = d.base;
            if (d.avisar) this.avisarRespaldo(userId, d.nuevos);
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

  private avisarRespaldo(userId: string, nuevos: number): void {
    this.avisador.broadcastToUser(userId, { type: 'im:new', nuevos });
    const body = nuevos === 1 ? 'Tenés 1 mensaje nuevo sin leer' : `Tenés ${nuevos} mensajes nuevos sin leer`;
    void this.ctx.hooks.doAction('core.push.send', { userId, title: 'Mensajes nuevos en Bitrix', body, url: URL_OFICINA })
      .catch(e => this.ctx.logger.warn(`Push de mensajes nuevos falló: ${e}`));
  }
}
