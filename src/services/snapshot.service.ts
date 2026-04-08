import type { PluginContext } from '@vla/plugin-sdk';
import type { BitrixService } from './bitrix.service';

export interface UserSnapshot {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isCheckedIn: boolean;
  status: string;
  statusMessage?: string;
  currentZoneId?: string;
  defaultZoneId?: string;
  positionX?: number;
  positionY?: number;
  lastActivityAt: string;
  checkedInAt?: string;
  photoUrl?: string;
  avatar: {
    skinColor: string;
    hairStyle: string;
    hairColor: string;
    shirtColor: string;
    accessory: string;
    emoji?: string;
  } | null;
}

export class SnapshotService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly bitrix?: BitrixService,
    private readonly pluginApiBase = '/api/v1/p/office',
  ) {}

  async getAll(): Promise<UserSnapshot[]> {
    const [users, presences, avatars, openCheckIns] = await Promise.all([
      this.ctx.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, firstName: true, lastName: true, email: true, role: true },
      }),
      this.ctx.prisma.presenceStatus.findMany(),
      this.ctx.prisma.userAvatar.findMany(),
      this.ctx.prisma.checkInRecord.findMany({
        where: { checkOutAt: null },
        orderBy: { checkInAt: 'desc' },
      }),
    ]);

    const presenceMap  = new Map(presences.map((p: any) => [p.userId, p]));
    const avatarMap    = new Map(avatars.map((a: any) => [a.userId, a]));
    // Keep only the latest open check-in per user
    const checkInMap   = new Map<string, any>();
    for (const r of openCheckIns as any[]) {
      if (!checkInMap.has(r.userId)) checkInMap.set(r.userId, r);
    }

    // Fetch Bitrix photos from Redis (non-blocking, best-effort)
    const userIds = users.map((u: any) => u.id);
    const photoMap = this.bitrix
      ? await this.bitrix.getAllPhotoUrls(userIds)
      : new Map<string, string>();

    return users.map((u: any) => {
      const p = presenceMap.get(u.id) as any;
      const a = avatarMap.get(u.id) as any;
      return {
        userId:        u.id,
        firstName:     u.firstName,
        lastName:      u.lastName,
        email:         u.email,
        role:          u.role,
        isCheckedIn:   p?.isCheckedIn  ?? false,
        status:        p?.status       ?? 'OFFLINE',
        statusMessage: p?.statusMessage ?? undefined,
        currentZoneId: p?.currentZoneId ?? undefined,
        defaultZoneId: p?.defaultZoneId ?? undefined,
        positionX:     p?.positionX    ?? undefined,
        positionY:     p?.positionY    ?? undefined,
        lastActivityAt: (p?.lastActivityAt ?? new Date()).toISOString(),
        checkedInAt:    checkInMap.get(u.id)?.checkInAt?.toISOString() ?? undefined,
        photoUrl: photoMap.has(u.id) ? `${this.pluginApiBase}/photo/${u.id}` : undefined,
        avatar: a ? {
          skinColor:  a.skinColor,
          hairStyle:  a.hairStyle,
          hairColor:  a.hairColor,
          shirtColor: a.shirtColor,
          accessory:  a.accessory,
          emoji:      a.emoji ?? undefined,
        } : null,
      };
    });
  }

  async updateAvatar(userId: string, data: {
    skinColor?: string; hairStyle?: string; hairColor?: string;
    shirtColor?: string; accessory?: string; emoji?: string;
  }): Promise<void> {
    await this.ctx.prisma.userAvatar.upsert({
      where:  { userId },
      create: { userId, skinColor: '#F5CBA7', hairStyle: 'short', hairColor: '#2C2C2C', shirtColor: '#3498DB', accessory: 'none', ...data },
      update: data,
    });
  }
}
