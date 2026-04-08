import type { PluginContext } from '@vla/plugin-sdk';

export interface BitrixUser {
  ID: string;
  NAME: string;
  LAST_NAME: string;
  EMAIL: string;
  PERSONAL_PHOTO?: string;
  ACTIVE: boolean;
}

export interface BitrixTimemanStatus {
  STATUS: 'OPENED' | 'CLOSED' | 'EXPIRED' | 'PAUSED';
  TIME_START: string | null;
  TIME_FINISH: string | null;
  ACTIVE: boolean;
}

const PHOTO_TTL = 60 * 60 * 24; // 24 h
const PHOTO_KEY = (userId: string) => `photo:${userId}`;

export class BitrixService {
  constructor(private readonly ctx: PluginContext) {}

  getWebhookUrl(): string | null {
    return (this.ctx.plugin.config?.bitrixWebhookUrl as string) ?? null;
  }

  isConfigured(): boolean {
    return !!this.getWebhookUrl();
  }

  // ── API call helper ────────────────────────────────────────────────────────

  private async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const base = this.getWebhookUrl();
    if (!base) throw new Error('Bitrix webhook URL not configured');

    const url = `${base.replace(/\/$/, '')}/${method}.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) throw new Error(`Bitrix API error: ${res.status}`);
    const data = await res.json() as { result: T; error?: string };
    if (data.error) throw new Error(`Bitrix error: ${data.error}`);
    return data.result;
  }

  // ── User & photo sync ──────────────────────────────────────────────────────

  async getBitrixUsers(): Promise<BitrixUser[]> {
    const users: BitrixUser[] = [];
    let start = 0;

    while (true) {
      const result = await this.call<{ result: BitrixUser[]; next?: number }>('user.get', {
        FILTER: { ACTIVE: true },
        SELECT: ['ID', 'NAME', 'LAST_NAME', 'EMAIL', 'PERSONAL_PHOTO'],
        start,
      }) as any;

      const page: BitrixUser[] = Array.isArray(result) ? result : result.result ?? [];
      users.push(...page);

      if (!result.next) break;
      start = result.next;
    }

    return users;
  }

  async syncPhotos(): Promise<{ synced: number; skipped: number }> {
    if (!this.isConfigured()) {
      this.ctx.logger.warn('Bitrix sync skipped: webhook URL not configured');
      return { synced: 0, skipped: 0 };
    }

    this.ctx.logger.log('Iniciando sincronización de fotos desde Bitrix...');

    const [bitrixUsers, mappings] = await Promise.all([
      this.getBitrixUsers(),
      this.ctx.prisma.bitrixUserMapping.findMany(),
    ]);

    const bitrixMap = new Map(bitrixUsers.map((u: BitrixUser) => [Number(u.ID), u]));

    let synced = 0;
    let skipped = 0;

    for (const mapping of mappings as any[]) {
      const bu = bitrixMap.get(mapping.bitrixUserId);
      if (!bu?.PERSONAL_PHOTO) { skipped++; continue; }

      await this.ctx.redis.set(PHOTO_KEY(mapping.userId), bu.PERSONAL_PHOTO, PHOTO_TTL);
      synced++;
    }

    this.ctx.logger.log(`Fotos sincronizadas: ${synced}, sin foto: ${skipped}`);
    return { synced, skipped };
  }

  async getPhotoUrl(userId: string): Promise<string | null> {
    return this.ctx.redis.get(PHOTO_KEY(userId));
  }

  async getAllPhotoUrls(userIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    await Promise.all(
      userIds.map(async (id) => {
        const url = await this.ctx.redis.get(PHOTO_KEY(id));
        if (url) map.set(id, url);
      }),
    );
    return map;
  }

  // ── Timeman status ─────────────────────────────────────────────────────────

  async getTimemanStatusForUser(bitrixUserId: number): Promise<BitrixTimemanStatus | null> {
    if (!this.isConfigured()) return null;
    try {
      const result = await this.call<BitrixTimemanStatus>('timeman.status', {
        USER_ID: bitrixUserId,
      });
      return result;
    } catch (e) {
      this.ctx.logger.warn(`timeman.status error for ${bitrixUserId}: ${e}`);
      return null;
    }
  }

  // ── Connection test ────────────────────────────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    try {
      const result = await this.call<any>('user.current');
      return {
        ok: true,
        user: `${result.NAME} ${result.LAST_NAME} (ID: ${result.ID})`,
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}
