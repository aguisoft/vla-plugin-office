import type { PluginContext } from '@vla/plugin-sdk';

const PRESENCE_CACHE_TTL = 120; // seconds

export type OfficeStatus = 'AVAILABLE' | 'BUSY' | 'IN_MEETING' | 'FOCUS' | 'LUNCH' | 'BRB' | 'OFFLINE';
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
    const now = new Date();

    const presence = await this.ctx.prisma.presenceStatus.upsert({
      where: { userId },
      create: {
        userId,
        isCheckedIn: true,
        status: 'AVAILABLE',
        lastActivityAt: now,
      },
      update: {
        isCheckedIn: true,
        status: 'AVAILABLE',
        lastActivityAt: now,
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

    return record;
  }

  async checkOut(userId: string, source: CheckSource = 'WEB'): Promise<void> {
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
  }

  async updateStatus(userId: string, status: OfficeStatus, statusMessage?: string): Promise<PresenceRecord> {
    const now = new Date();

    const presence = await this.ctx.prisma.presenceStatus.upsert({
      where: { userId },
      create: { userId, status, isCheckedIn: true, statusMessage: statusMessage ?? null, lastActivityAt: now },
      update: { status, statusMessage: statusMessage ?? null, lastActivityAt: now },
    });

    const record = this.toRecord(presence);
    await this.ctx.redis.setJson(`presence:${userId}`, record, PRESENCE_CACHE_TTL);
    await this.ctx.hooks.doAction('office.user.status_changed', { userId, status });
    this.broadcast({ type: 'user:status', userId, status, statusMessage });

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
      isCheckedIn: p.isCheckedIn,
      statusMessage: p.statusMessage ?? undefined,
      currentZoneId: p.currentZoneId ?? undefined,
    };
  }
}
