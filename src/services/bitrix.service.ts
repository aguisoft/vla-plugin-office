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

/**
 * Domain-specific Bitrix helper for the office plugin.
 * Delegates all API calls to ctx.bitrix (core OAuth2 client).
 */
export class BitrixService {
  constructor(private readonly ctx: PluginContext) {}

  isConfigured(): boolean {
    return this.ctx.bitrix?.isConfigured() ?? false;
  }

  // ── User list ───────────────────────────────────────────────────────────────

  async getBitrixUsers(): Promise<BitrixUser[]> {
    return this.ctx.bitrix!.callAll<BitrixUser>('user.get', {
      FILTER: { ACTIVE: true },
      SELECT: ['ID', 'NAME', 'LAST_NAME', 'EMAIL', 'PERSONAL_PHOTO'],
    });
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
      this.ctx.logger.warn('Bitrix sync skipped: not configured');
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
      return await this.ctx.bitrix!.call<BitrixTimemanStatus>('timeman.status', {
        USER_ID: bitrixUserId,
      });
    } catch (e) {
      this.ctx.logger.warn(`timeman.status error for bitrix user ${bitrixUserId}: ${e}`);
      return null;
    }
  }

  // ── Timeman open / close ───────────────────────────────────────────────────

  async timemanOpen(bitrixUserId: number): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      // Check current status first — if EXPIRED, close it before opening new day
      const status = await this.getTimemanStatusForUser(bitrixUserId);
      if (status?.STATUS === 'EXPIRED') {
        this.ctx.logger.warn(`timeman: user ${bitrixUserId} has EXPIRED workday, attempting close first`);
        try {
          await this.ctx.bitrix!.call('timeman.close', { USER_ID: bitrixUserId });
        } catch {
          this.ctx.logger.warn(`timeman: could not close EXPIRED workday for ${bitrixUserId} (requires manual close in Bitrix UI)`);
        }
      }
      await this.ctx.bitrix!.call('timeman.open', { USER_ID: bitrixUserId });
      return true;
    } catch (e) {
      this.ctx.logger.warn(`timeman.open error for bitrix user ${bitrixUserId}: ${e}`);
      return false;
    }
  }

  async timemanClose(bitrixUserId: number): Promise<boolean> {
    if (!this.isConfigured()) return false;
    try {
      // Check current status — EXPIRED workdays can't be closed via API
      const status = await this.getTimemanStatusForUser(bitrixUserId);
      if (status?.STATUS === 'EXPIRED') {
        this.ctx.logger.warn(`timeman: user ${bitrixUserId} has EXPIRED workday — must be closed manually from Bitrix UI`);
        return false;
      }
      if (status?.STATUS === 'CLOSED') {
        return true; // already closed
      }
      await this.ctx.bitrix!.call('timeman.close', { USER_ID: bitrixUserId });
      return true;
    } catch (e) {
      this.ctx.logger.warn(`timeman.close error for bitrix user ${bitrixUserId}: ${e}`);
      return false;
    }
  }

  /** Resolve VLA userId → Bitrix user ID via email mapping */
  async getBitrixIdForVlaUser(userId: string): Promise<number | null> {
    const mapping = await this.ctx.prisma.bitrixUserMapping.findFirst({
      where: { userId },
    });
    return mapping?.bitrixUserId ?? null;
  }

  // ── Timeman bulk sync (matches by email) ───────────────────────────────────

  async syncTimemanStatuses(): Promise<Array<{ userId: string; isOpen: boolean }>> {
    if (!this.isConfigured()) return [];

    const [bitrixUsers, vlaByEmail] = await Promise.all([
      this.getBitrixUsers(),
      this.getVlaEmailMap(),
    ]);

    const matched = bitrixUsers.filter(bu => {
      const email = bu.EMAIL?.toLowerCase();
      return email && vlaByEmail.has(email);
    });

    if (matched.length === 0) {
      this.ctx.logger.warn('Timeman sync: no se encontraron usuarios de Bitrix con email coincidente en VLA');
      return [];
    }

    this.ctx.logger.log(`Timeman sync: ${matched.length} usuarios coincidentes por email`);

    const results = await Promise.allSettled(
      matched.map(async (bu) => {
        const userId = vlaByEmail.get(bu.EMAIL.toLowerCase())!;
        const status = await this.getTimemanStatusForUser(Number(bu.ID));
        const isOpen = status?.STATUS === 'OPENED'
          || status?.STATUS === 'PAUSED'
          || (status?.STATUS === 'EXPIRED' && status?.ACTIVE === true);
        this.ctx.logger.log(
          `Timeman [${bu.EMAIL}] bitrixId=${bu.ID} STATUS=${status?.STATUS ?? 'null'} ACTIVE=${status?.ACTIVE} → isOpen=${isOpen}`,
        );
        return { userId, isOpen };
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<{ userId: string; isOpen: boolean }> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  // ── Timeman diagnostic ─────────────────────────────────────────────────────

  async debugTimeman(): Promise<Array<{ email: string; bitrixId: string; raw: any }>> {
    if (!this.isConfigured()) return [];

    const [bitrixUsers, vlaByEmail] = await Promise.all([
      this.getBitrixUsers(),
      this.getVlaEmailMap(),
    ]);

    const matched = bitrixUsers.filter(bu => bu.EMAIL && vlaByEmail.has(bu.EMAIL.toLowerCase()));

    const results = await Promise.allSettled(
      matched.map(async (bu) => {
        try {
          const raw = await this.ctx.bitrix!.callRaw<any>('timeman.status', { USER_ID: Number(bu.ID) });
          return { email: bu.EMAIL, bitrixId: bu.ID, raw };
        } catch (e) {
          return { email: bu.EMAIL, bitrixId: bu.ID, raw: { error: String(e) } };
        }
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  // ── Connection test ─────────────────────────────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    try {
      const result = await this.ctx.bitrix!.call<any>('user.current');
      return {
        ok: true,
        user: `${result.NAME} ${result.LAST_NAME} (ID: ${result.ID})`,
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }
}
