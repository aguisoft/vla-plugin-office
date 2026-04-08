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

  // ── API call helpers ────────────────────────────────────────────────────────

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

  /** Returns full API response including `next` cursor for paginated calls */
  private async callRaw<T>(method: string, params: Record<string, unknown> = {}): Promise<{ result: T; next?: number; total?: number }> {
    const base = this.getWebhookUrl();
    if (!base) throw new Error('Bitrix webhook URL not configured');

    const url = `${base.replace(/\/$/, '')}/${method}.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) throw new Error(`Bitrix API error: ${res.status}`);
    const data = await res.json() as { result: T; next?: number; total?: number; error?: string };
    if (data.error) throw new Error(`Bitrix error: ${data.error}`);
    return data;
  }

  // ── User list ───────────────────────────────────────────────────────────────

  async getBitrixUsers(): Promise<BitrixUser[]> {
    const users: BitrixUser[] = [];
    let start = 0;

    while (true) {
      const { result: page, next } = await this.callRaw<BitrixUser[]>('user.get', {
        FILTER: { ACTIVE: true },
        SELECT: ['ID', 'NAME', 'LAST_NAME', 'EMAIL', 'PERSONAL_PHOTO'],
        start,
      });

      users.push(...(page ?? []));
      if (!next) break;
      start = next;
    }

    return users;
  }

  // ── Email-based VLA user lookup ────────────────────────────────────────────

  private async getVlaEmailMap(): Promise<Map<string, string>> {
    const vlaUsers = await this.ctx.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true },
    });
    return new Map((vlaUsers as any[]).map((u: any) => [u.email.toLowerCase(), u.id as string]));
  }

  // ── Photo sync ─────────────────────────────────────────────────────────────

  async syncPhotos(): Promise<{ synced: number; skipped: number }> {
    if (!this.isConfigured()) {
      this.ctx.logger.warn('Bitrix sync skipped: webhook URL not configured');
      return { synced: 0, skipped: 0 };
    }

    this.ctx.logger.log('Iniciando sincronización de fotos desde Bitrix...');

    const [bitrixUsers, vlaByEmail] = await Promise.all([
      this.getBitrixUsers(),
      this.getVlaEmailMap(),
    ]);

    let synced = 0;
    let skipped = 0;

    for (const bu of bitrixUsers) {
      if (!bu.PERSONAL_PHOTO) { skipped++; continue; }
      const email = bu.EMAIL?.toLowerCase();
      if (!email) { skipped++; continue; }
      const userId = vlaByEmail.get(email);
      if (!userId) { skipped++; continue; }

      await this.ctx.redis.set(PHOTO_KEY(userId), bu.PERSONAL_PHOTO, PHOTO_TTL);
      synced++;
    }

    this.ctx.logger.log(`Fotos sincronizadas: ${synced}, sin foto/usuario: ${skipped}`);
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

  // ── Timeman status ──────────────────────────────────────────────────────────

  async getTimemanStatusForUser(bitrixUserId: number): Promise<BitrixTimemanStatus | null> {
    if (!this.isConfigured()) return null;
    try {
      const result = await this.call<BitrixTimemanStatus>('timeman.status', {
        USER_ID: bitrixUserId,
      });
      return result;
    } catch (e) {
      this.ctx.logger.warn(`timeman.status error for bitrix user ${bitrixUserId}: ${e}`);
      return null;
    }
  }

  // ── Timeman bulk sync (matches by email) ───────────────────────────────────

  async syncTimemanStatuses(): Promise<Array<{ userId: string; isOpen: boolean }>> {
    if (!this.isConfigured()) return [];

    const [bitrixUsers, vlaByEmail] = await Promise.all([
      this.getBitrixUsers(),
      this.getVlaEmailMap(),
    ]);

    // Only process Bitrix users that have a matching VLA account by email
    const matched = bitrixUsers.filter(bu => {
      const email = bu.EMAIL?.toLowerCase();
      return email && vlaByEmail.has(email);
    });

    if (matched.length === 0) {
      this.ctx.logger.warn('Timeman sync: no se encontraron usuarios de Bitrix con email coincidente en VLA');
      return [];
    }

    const results = await Promise.allSettled(
      matched.map(async (bu) => {
        const userId = vlaByEmail.get(bu.EMAIL.toLowerCase())!;
        const status = await this.getTimemanStatusForUser(Number(bu.ID));
        // OPENED = trabajando, PAUSED = en pausa (sigue en oficina)
        const isOpen = status?.STATUS === 'OPENED' || status?.STATUS === 'PAUSED';
        return { userId, isOpen };
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<{ userId: string; isOpen: boolean }> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  // ── Connection test ─────────────────────────────────────────────────────────

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
