import type { PluginContext } from '@vla/plugin-sdk';

const PRESENCE_CACHE_TTL = 120; // seconds

export type OfficeStatus = 'IN_OFFICE' | 'REMOTE' | 'BREAK' | 'LUNCH' | 'MEETING' | 'AWAY';
export type CheckSource = 'BITRIX' | 'MANUAL' | 'API';

export interface PresenceRecord {
  userId: string;
  status: OfficeStatus;
  isInOffice: boolean;
  customStatus?: string;
  checkedInAt?: Date;
}

/**
 * Manages user check-in/check-out and presence state.
 * Uses ctx.prisma for persistence and ctx.redis for caching.
 */
export class PresenceService {
  constructor(private readonly ctx: PluginContext) {}

  async checkIn(userId: string, source: CheckSource = 'MANUAL'): Promise<PresenceRecord> {
    const now = new Date();

    // Upsert presence status
    const presence = await this.ctx.prisma.presenceStatus.upsert({
      where: { userId },
      create: {
        userId,
        isInOffice: true,
        status: 'IN_OFFICE',
        checkedInAt: now,
        lastSeenAt: now,
      },
      update: {
        isInOffice: true,
        status: 'IN_OFFICE',
        checkedInAt: now,
        lastSeenAt: now,
      },
    });

    // Create check-in record
    await this.ctx.prisma.checkInRecord.create({
      data: {
        userId,
        action: 'CHECK_IN',
        source,
        timestamp: now,
      },
    });

    const record = this.toRecord(presence);

    // Cache presence + emit events
    await this.ctx.redis.setJson(`presence:${userId}`, record, PRESENCE_CACHE_TTL);
    await this.ctx.hooks.doAction('office.user.checked_in', { userId, source });

    // Broadcast SSE event
    this.broadcast({ type: 'user:joined', userId });

    return record;
  }

  async checkOut(userId: string, source: CheckSource = 'MANUAL'): Promise<void> {
    const now = new Date();

    await this.ctx.prisma.presenceStatus.upsert({
      where: { userId },
      create: {
        userId,
        isInOffice: false,
        status: 'AWAY',
        lastSeenAt: now,
      },
      update: {
        isInOffice: false,
        status: 'AWAY',
        checkedOutAt: now,
        lastSeenAt: now,
      },
    });

    await this.ctx.prisma.checkInRecord.create({
      data: {
        userId,
        action: 'CHECK_OUT',
        source,
        timestamp: now,
      },
    });

    await this.ctx.redis.del(`presence:${userId}`);
    await this.ctx.hooks.doAction('office.user.checked_out', { userId });

    this.broadcast({ type: 'user:left', userId });
  }

  async updateStatus(userId: string, status: OfficeStatus, customStatus?: string): Promise<PresenceRecord> {
    const now = new Date();

    const presence = await this.ctx.prisma.presenceStatus.upsert({
      where: { userId },
      create: { userId, status, isInOffice: true, customStatus: customStatus ?? null, lastSeenAt: now },
      update: { status, customStatus: customStatus ?? null, lastSeenAt: now },
    });

    const record = this.toRecord(presence);
    await this.ctx.redis.setJson(`presence:${userId}`, record, PRESENCE_CACHE_TTL);
    await this.ctx.hooks.doAction('office.user.status_changed', { userId, status });
    this.broadcast({ type: 'user:status', userId, status, customStatus });

    return record;
  }

  async getAll(): Promise<PresenceRecord[]> {
    const records = await this.ctx.prisma.presenceStatus.findMany({
      where: { isInOffice: true },
      orderBy: { checkedInAt: 'asc' },
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

  private clients = new Set<(data: string) => void>();

  subscribe(send: (data: string) => void): () => void {
    this.clients.add(send);
    return () => this.clients.delete(send);
  }

  private broadcast(payload: object): void {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const send of this.clients) {
      try { send(data); } catch { this.clients.delete(send); }
    }
  }

  private toRecord(p: any): PresenceRecord {
    return {
      userId: p.userId,
      status: p.status,
      isInOffice: p.isInOffice,
      customStatus: p.customStatus ?? undefined,
      checkedInAt: p.checkedInAt ?? undefined,
    };
  }
}
