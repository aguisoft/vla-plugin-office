import type { PluginContext } from '@vla/plugin-sdk';

const PRESENCE_CACHE_TTL = 120; // seconds

export type OfficeStatus =
  | 'AVAILABLE' | 'IN_MEETING_INTERNAL' | 'IN_MEETING_EXTERNAL'
  | 'FOCUS' | 'LUNCH' | 'BRB' | 'OFFLINE';

export interface StatusExtra {
  justification?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  meetingId?: string | null;
}

export type CheckSource = 'WEB' | 'BITRIX' | 'MOBILE';

export interface PresenceRecord {
  userId: string;
  status: OfficeStatus;
  isCheckedIn: boolean;
  statusMessage?: string;
  currentZoneId?: string;
}

/**
 * Manages user check-in/check-out and presence state.
 * Uses ctx.prisma for persistence and ctx.redis for caching.
 */
export class PresenceService {
  constructor(private readonly ctx: PluginContext) {}

  // Inyectado tras construir MeetingService en index.ts (que a su vez depende
  // de este servicio para broadcastToUser — un setter rompe el ciclo que un
  // parámetro de constructor no podría). Sin este hook, checkIn/checkOut
  // limpian la fila de PresenceStatus del usuario pero nunca cancelan las
  // reuniones que hospeda ni la invitación que había aceptado, dejando a
  // otros varados en IN_MEETING_INTERNAL — ver Fix #1 de la ola final.
  private releaseFromMeetings: ((userId: string) => Promise<void>) | null = null;

  setMeetingReleaser(fn: (userId: string) => Promise<void>): void {
    this.releaseFromMeetings = fn;
  }

  /**
   * Registra el cambio de estado en el historial.
   *
   * Cerrar el intervalo abierto e insertar el nuevo van en UNA sentencia con CTE:
   * cada llamada a `ctx.query` abre su propia transacción, así que dos llamadas
   * separadas podrían dejar a alguien sin intervalo abierto si falla la segunda.
   *
   * Si el intervalo abierto ya tiene ese mismo estado, solo se actualiza la
   * justificación. Reescribir el motivo de un Concentrado no debe cortar el
   * tiempo acumulado.
   *
   * NUNCA lanza: un fallo acá no puede impedir que alguien cambie su estado. El
   * costo aceptado es que un fallo deja el historial divergido en silencio, y eso
   * se detecta en el reporte como "sin registrar" creciendo.
   */
  private async recordTransition(
    userId: string,
    status: string,
    at: Date,
    justification: string | null,
    source: CheckSource,
  ): Promise<void> {
    try {
      const abierto = await this.ctx.query<{ status: string }>(
        'SELECT status FROM office_status_intervals WHERE user_id = $1 AND ended_at IS NULL LIMIT 1',
        [userId],
      );

      if (abierto.length > 0 && abierto[0].status === status) {
        await this.ctx.query(
          'UPDATE office_status_intervals SET justification = $2 WHERE user_id = $1 AND ended_at IS NULL',
          [userId, justification],
        );
        return;
      }

      // Una sola sentencia: el CTE cierra y el INSERT abre, atómicamente.
      // Empieza con WITH y lleva RETURNING para que `ctx.query` la ejecute por la
      // vía que devuelve filas.
      //
      // El INSERT lee de `(SELECT count(*) FROM cerrado)` en vez de un VALUES
      // suelto a propósito: verificado en local (PG 16) que sin esa lectura,
      // Postgres NO garantiza que el UPDATE de `cerrado` sea visible para el
      // chequeo de unicidad del INSERT dentro de la misma sentencia — el índice
      // único parcial (user_id) WHERE ended_at IS NULL revienta con 23505
      // "already exists" aun cuando el UPDATE sí cerró la fila abierta. Es el
      // comportamiento documentado de Postgres para CTEs de escritura hermanas
      // sin relación productor/consumidor ("no pueden verse los efectos entre
      // sí"). El count(*) siempre devuelve una fila (0 o 1), así que fuerza la
      // dependencia de datos sin filtrar el INSERT cuando no había nada que
      // cerrar (primer check-in de alguien).
      await this.ctx.query(
        `WITH cerrado AS (
           UPDATE office_status_intervals
              SET ended_at = $2
            WHERE user_id = $1 AND ended_at IS NULL
          RETURNING id
         )
         INSERT INTO office_status_intervals (user_id, status, started_at, justification, source)
         SELECT $1, $3, $2, $4, $5
           FROM (SELECT count(*) FROM cerrado) AS forzar_orden
         RETURNING id`,
        [userId, at.toISOString(), status, justification, source],
      );
    } catch (e) {
      this.ctx.logger.warn(`No se pudo registrar la transición de ${userId} a ${status}: ${e}`);
    }
  }

  private manualOverrideKey(userId: string) { return `manual-override:${userId}`; }

  async setManualOverride(userId: string): Promise<void> {
    await this.ctx.redis.set(this.manualOverrideKey(userId), '1', 600); // 10 min
  }

  async hasManualOverride(userId: string): Promise<boolean> {
    const v = await this.ctx.redis.get(this.manualOverrideKey(userId));
    return v === '1';
  }

  async clearManualOverride(userId: string): Promise<void> {
    await this.ctx.redis.del(this.manualOverrideKey(userId));
  }

  async checkIn(userId: string, source: CheckSource = 'WEB'): Promise<PresenceRecord> {
    if (this.releaseFromMeetings) await this.releaseFromMeetings(userId);
    const now = new Date();

    const presence = await this.ctx.prisma.presenceStatus.upsert({
      where: { userId },
      create: { userId, isCheckedIn: true, status: 'AVAILABLE', lastActivityAt: now },
      update: {
        isCheckedIn: true, status: 'AVAILABLE', lastActivityAt: now,
        justification: null, statusStartsAt: null, statusEndsAt: null, meetingId: null,
      },
    });

    // Close any open check-in record first, then create new one
    await this.ctx.prisma.checkInRecord.updateMany({
      where: { userId, checkOutAt: null },
      data: { checkOutAt: now },
    });

    await this.ctx.prisma.checkInRecord.create({
      data: { userId, source, checkInAt: now },
    });

    const record = this.toRecord(presence);
    await this.ctx.redis.setJson(`presence:${userId}`, record, PRESENCE_CACHE_TTL);
    await this.ctx.hooks.doAction('office.user.checked_in', { userId, source });
    this.broadcast({ type: 'user:joined', userId });
    await this.recordTransition(userId, 'AVAILABLE', now, null, source);

    return record;
  }

  async checkOut(userId: string, source: CheckSource = 'WEB'): Promise<void> {
    if (this.releaseFromMeetings) await this.releaseFromMeetings(userId);
    const now = new Date();

    await this.ctx.prisma.presenceStatus.upsert({
      where: { userId },
      create: {
        userId,
        isCheckedIn: false,
        status: 'OFFLINE',
        lastActivityAt: now,
      },
      update: {
        isCheckedIn: false,
        status: 'OFFLINE',
        currentZoneId: null,
        positionX: null,
        positionY: null,
        lastActivityAt: now,
        justification: null, statusStartsAt: null, statusEndsAt: null, meetingId: null,
      },
    });

    // Close the open check-in record
    const open = await this.ctx.prisma.checkInRecord.findFirst({
      where: { userId, checkOutAt: null },
      orderBy: { checkInAt: 'desc' },
    });
    if (open) {
      const totalMinutes = Math.floor((now.getTime() - open.checkInAt.getTime()) / 60000);
      await this.ctx.prisma.checkInRecord.update({
        where: { id: open.id },
        data: { checkOutAt: now, totalMinutes },
      });
    }

    await this.ctx.redis.del(`presence:${userId}`);
    await this.ctx.hooks.doAction('office.user.checked_out', { userId });
    this.broadcast({ type: 'user:left', userId });
    await this.recordTransition(userId, 'OFFLINE', now, null, source);
  }

  async updateStatus(
    userId: string,
    status: OfficeStatus,
    extra: StatusExtra = {},
  ): Promise<PresenceRecord> {
    const now = new Date();
    const data = {
      status,
      justification:  extra.justification ?? null,
      statusStartsAt: extra.startsAt ?? null,
      statusEndsAt:   extra.endsAt ?? null,
      meetingId:      extra.meetingId ?? null,
      lastActivityAt: now,
    };

    const presence = await this.ctx.prisma.presenceStatus.upsert({
      where:  { userId },
      create: { userId, isCheckedIn: true, ...data },
      update: data,
    });

    const record = this.toRecord(presence);
    await this.ctx.redis.setJson(`presence:${userId}`, record, PRESENCE_CACHE_TTL);
    await this.ctx.hooks.doAction('office.user.status_changed', { userId, status });
    this.broadcast({ type: 'user:status', userId, status });
    await this.recordTransition(userId, status, now, extra.justification ?? null, 'WEB');

    return record;
  }

  async getAll(): Promise<PresenceRecord[]> {
    const records = await this.ctx.prisma.presenceStatus.findMany({
      where: { isCheckedIn: true },
      orderBy: { lastActivityAt: 'asc' },
    });
    return records.map((r: any) => this.toRecord(r));
  }

  async getAllIncludingOffline(): Promise<PresenceRecord[]> {
    const records = await this.ctx.prisma.presenceStatus.findMany({
      orderBy: { lastActivityAt: 'asc' },
    });
    return records.map((r: any) => this.toRecord(r));
  }

  async getOne(userId: string): Promise<PresenceRecord | null> {
    const cached = await this.ctx.redis.getJson<PresenceRecord>(`presence:${userId}`);
    if (cached) return cached;

    const record = await this.ctx.prisma.presenceStatus.findUnique({ where: { userId } });
    return record ? this.toRecord(record) : null;
  }

  // ── SSE broadcast ─────────────────────────────────────────────────────────

  private clients = new Map<(data: string) => void, string | null>();

  subscribe(send: (data: string) => void, userId: string | null = null): () => void {
    this.clients.set(send, userId);
    return () => this.clients.delete(send);
  }

  private broadcast(payload: object): void {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const [send] of this.clients) {
      try { send(data); } catch { this.clients.delete(send); }
    }
  }

  /**
   * Avisa a todas las pantallas de un cambio que NO nació de una acción.
   *
   * Todo lo demás que se difunde ocurre porque alguien hizo algo: marcó
   * entrada, cambió de estado, se movió. Las ausencias programadas y los
   * feriados no: empiezan y terminan por reloj. A esa hora no hay nada que
   * emitir, así que la pantalla se queda con el estado viejo hasta que otra
   * persona haga algo y dispare una recarga de rebote.
   *
   * Eso ya se vio en producción: un permiso de 10:00 a 10:20, creado a las
   * 09:57. El evento de creación refrescó la pantalla a las 09:57 —cuando el
   * permiso todavía no había empezado, así que seguía diciendo «Disponible»—
   * y a las 10:00 no se disparó nada. En una ausencia de veinte minutos eso
   * se come media ventana.
   *
   * El método es público y acotado a este caso; `broadcast` sigue privado
   * para que nadie difunda cualquier cosa desde afuera.
   */
  anunciarCambioPorReloj(userIds: string[]): void {
    this.broadcast({ type: 'absence:window', userIds });
  }

  /** Manda solo a las conexiones de ese usuario. Para invitaciones dirigidas. */
  broadcastToUser(userId: string, payload: object): void {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const [send, uid] of this.clients) {
      if (uid !== userId) continue;
      try { send(data); } catch { this.clients.delete(send); }
    }
  }

  private toRecord(p: any): PresenceRecord {
    return {
      userId: p.userId,
      status: p.status,
      isCheckedIn: p.isCheckedIn,
      statusMessage: p.statusMessage ?? undefined,
      currentZoneId: p.currentZoneId ?? undefined,
    };
  }
}
