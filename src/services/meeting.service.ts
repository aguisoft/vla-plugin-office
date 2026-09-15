import type { PluginContext } from '@vla/plugin-sdk';
import { nextInviteState, isExpired, INVITE_TTL_MS, type InviteAction } from '../lib/meeting-invites';

export interface PendingInvite {
  id: string;
  meetingId: string;
  hostId: string;
  hostName: string;
  justification: string | null;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Invitaciones a reunión interna. El anfitrión marca su estado y entra de
 * inmediato; cada invitado recibe su propia invitación por SSE dirigido y
 * decide por su cuenta. Toda la decisión de transición de estado vive en
 * `meeting-invites.ts` (`nextInviteState`/`isExpired`) — este servicio solo
 * lee y escribe filas de `MeetingInvite` a partir de esas decisiones.
 */
export class MeetingService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly broadcastToUser: (userId: string, payload: object) => void,
    // Cierra el círculo con PresenceService sin depender de su tipo (evitaría
    // un ciclo: PresenceService se construye antes que este servicio). Vuelve
    // a AVAILABLE a los participantes que `cancelMeetingsHostedBy` libera.
    private readonly setAvailable: (userId: string) => Promise<void>,
  ) {}

  async invite(
    hostId: string,
    participantIds: string[],
    _justification: string,
  ): Promise<{ meetingId: string }> {
    const meetingId = cryptoRandomId();

    // Si el host ya tenía una reunión abierta, se cierra antes de abrir otra
    // y quien la había aceptado vuelve a AVAILABLE. Pasa por el mismo helper
    // que releaseUser() en vez de llamar cancelMeetingsHostedBy() a secas:
    // hoy es un no-op porque el caller (PATCH /presence/status) ya liberó al
    // host antes de llegar acá, pero si algún día invite() se llama sin ese
    // release explícito previo, descartar el retorno dejaría gente varada en
    // silencio (defecto #41 de la revisión final). Consumirlo acá lo vuelve
    // imposible de saltar.
    await this.releaseHostedMeetings(hostId);

    for (const inviteeId of participantIds) {
      const row = await this.ctx.prisma.meetingInvite.create({
        data: { meetingId, hostId, inviteeId, state: 'PENDING' },
      });
      this.broadcastToUser(inviteeId, {
        type: 'meeting:invite',
        inviteId: (row as any).id,
        meetingId,
        hostId,
      });
    }

    return { meetingId };
  }

  async pendingFor(userId: string): Promise<PendingInvite[]> {
    const rows = await this.ctx.prisma.meetingInvite.findMany({
      where: { inviteeId: userId, state: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const live: any[] = [];
    for (const r of rows as any[]) {
      if (isExpired(r.createdAt, now)) {
        // Se barre al leer; no hay cron de vencimiento.
        await this.ctx.prisma.meetingInvite.update({
          where: { id: r.id },
          data: { state: 'EXPIRED' },
        });
      } else {
        live.push(r);
      }
    }
    if (!live.length) return [];

    const hostIds = [...new Set(live.map(r => r.hostId))];
    const [hosts, presences] = await Promise.all([
      this.ctx.prisma.user.findMany({
        where: { id: { in: hostIds } },
        select: { id: true, firstName: true, lastName: true },
      }),
      this.ctx.prisma.presenceStatus.findMany({ where: { userId: { in: hostIds } } }),
    ]);
    const nameOf = new Map((hosts as any[]).map(h => [h.id, `${h.firstName} ${h.lastName}`]));
    const justOf = new Map((presences as any[]).map(p => [p.userId, p.justification]));

    return live.map(r => ({
      id: r.id,
      meetingId: r.meetingId,
      hostId: r.hostId,
      hostName: nameOf.get(r.hostId) ?? 'Desconocido',
      justification: justOf.get(r.hostId) ?? null,
      createdAt: r.createdAt,
      expiresAt: new Date(r.createdAt.getTime() + INVITE_TTL_MS),
    }));
  }

  async respond(
    inviteId: string,
    userId: string,
    action: InviteAction,
  ): Promise<{ ok: true; meetingId: string; hostId: string } | { ok: false; reason: string }> {
    const row = await this.ctx.prisma.meetingInvite.findUnique({ where: { id: inviteId } });
    if (!row) return { ok: false, reason: 'not_found' };
    if ((row as any).inviteeId !== userId) return { ok: false, reason: 'not_yours' };

    const t = nextInviteState((row as any).state, action, (row as any).createdAt, new Date());
    if ('error' in t) {
      if (t.error === 'expired') {
        await this.ctx.prisma.meetingInvite.update({
          where: { id: inviteId },
          data: { state: 'EXPIRED' },
        });
      }
      return { ok: false, reason: t.error };
    }

    await this.ctx.prisma.meetingInvite.update({
      where: { id: inviteId },
      data: { state: t.state, respondedAt: new Date() },
    });

    return { ok: true, meetingId: (row as any).meetingId, hostId: (row as any).hostId };
  }

  /**
   * Cancela todas las invitaciones de las reuniones que hospeda este usuario.
   * Devuelve los userId que estaban ACCEPTED y hay que regresar a AVAILABLE.
   *
   * El `WHERE` de abajo es solo una acotación de performance (no traer todo
   * el historial del host); la decisión real de qué fila puede cancelarse la
   * sigue tomando `nextInviteState`, no este filtro — si esa regla cambiara
   * algún día, este WHERE en el peor caso deja de ser exacto, pero nunca
   * cancela algo que la función no autorice.
   *
   * Devuelve la lista en vez de aplicar el AVAILABLE ella misma porque el
   * PATCH de status histórico necesitaba el dato crudo; `releaseHostedMeetings`
   * de abajo es quien de verdad lo consume hoy. Se mantiene público porque
   * ese es el contrato que ya usaban los callers existentes.
   */
  async cancelMeetingsHostedBy(hostId: string): Promise<string[]> {
    const rows = await this.ctx.prisma.meetingInvite.findMany({
      where: { hostId, state: { in: ['PENDING', 'ACCEPTED'] } },
    });
    if (!rows.length) return [];

    const now = new Date();
    const toCancel = (rows as any[]).filter(
      r => 'state' in nextInviteState(r.state, 'cancel', r.createdAt, now),
    );
    if (!toCancel.length) return [];

    const accepted = toCancel.filter(r => r.state === 'ACCEPTED').map(r => r.inviteeId);

    await this.ctx.prisma.meetingInvite.updateMany({
      where: { id: { in: toCancel.map(r => r.id) } },
      data: { state: 'CANCELLED', respondedAt: now },
    });

    for (const r of toCancel) {
      this.broadcastToUser(r.inviteeId, { type: 'meeting:cancelled', meetingId: r.meetingId });
    }

    return accepted;
  }

  /** Cancela lo que `hostId` hospeda y devuelve a AVAILABLE a quien lo había
   *  aceptado. Privado: todo caller externo pasa por `releaseUser`. */
  private async releaseHostedMeetings(hostId: string): Promise<void> {
    const returning = await this.cancelMeetingsHostedBy(hostId);
    for (const participantId of returning) {
      await this.setAvailable(participantId);
    }
  }

  /**
   * Libera por completo a un usuario del ciclo de vida de reunión, antes de
   * que cambie de estado, se desconecte, o quede inactivo. Dos partes:
   *
   *  1. Si hospeda una reunión, se cancela y quien la había aceptado vuelve
   *     a AVAILABLE (`releaseHostedMeetings`).
   *  2. Si es invitado con una invitación aceptada, esa fila se cierra — sin
   *     esto, `meetingWith` (armado con filas ACCEPTED) seguiría listándolo
   *     en la tarjeta del host después de que se fue.
   *
   * `exceptInviteId` existe solo para el handler de aceptar: ahí este método
   * se llama DESPUÉS de que `respond()` ya puso la invitación nueva en
   * ACCEPTED, así que sin la excepción se cancelaría a sí misma.
   *
   * Único punto de entrada para el release — index.ts lo llama desde el PATCH
   * de status y desde el handler de aceptar; PresenceService lo invoca desde
   * checkIn/checkOut, así que cron e webhook de Bitrix lo heredan gratis.
   */
  async releaseUser(userId: string, exceptInviteId?: string): Promise<void> {
    await this.releaseHostedMeetings(userId);
    await this.ctx.prisma.meetingInvite.updateMany({
      where: {
        inviteeId: userId,
        state: 'ACCEPTED',
        ...(exceptInviteId ? { id: { not: exceptInviteId } } : {}),
      },
      data: { state: 'CANCELLED', respondedAt: new Date() },
    });
  }

  async participantsOf(meetingId: string): Promise<string[]> {
    const rows = await this.ctx.prisma.meetingInvite.findMany({
      where: { meetingId, state: 'ACCEPTED' },
    });
    return (rows as any[]).map(r => r.inviteeId);
  }
}

function cryptoRandomId(): string {
  // El core corre en Node 18+, así que randomUUID está disponible sin import.
  return globalThis.crypto.randomUUID();
}
