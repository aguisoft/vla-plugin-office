import type { PluginContext } from '@vla/plugin-sdk';

export class OrgService {
  /**
   * defaultCountry es una función y no un string porque ctx.plugin.config se
   * hidrata desde la base DESPUÉS de registrar el plugin: si se leyera en el
   * constructor, siempre daría el valor de respaldo.
   */
  constructor(
    private readonly ctx: PluginContext,
    private readonly defaultCountry: () => string,
  ) {}

  /** Jefe directo: override del plugin, si no el UF_HEAD del departamento. */
  async managerOf(userId: string): Promise<string | null> {
    const override = await this.ctx.prisma.userProfileOverride.findUnique({ where: { userId } });
    if ((override as any)?.managerUserId) return (override as any).managerUserId;

    const mine = await this.ctx.prisma.bitrixUserMapping.findUnique({ where: { userId } });
    const deptId = (mine as any)?.departmentId;
    if (!deptId) return null;

    const head = await this.ctx.prisma.bitrixUserMapping.findFirst({
      where: { departmentId: deptId, isDepartmentHead: true },
    });
    const headUserId = (head as any)?.userId ?? null;
    // Nadie es su propio jefe.
    return headUserId && headUserId !== userId ? headUserId : null;
  }

  async isManagerOf(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) return false;
    return (await this.managerOf(targetId)) === viewerId;
  }

  /** Todos los subordinados directos del viewer. Para el snapshot. */
  async managedUserIds(viewerId: string): Promise<Set<string>> {
    const result = new Set<string>();

    const overrides = await this.ctx.prisma.userProfileOverride.findMany({
      where: { managerUserId: viewerId },
    });
    for (const o of overrides as any[]) result.add(o.userId);

    const me = await this.ctx.prisma.bitrixUserMapping.findUnique({ where: { userId: viewerId } });
    if ((me as any)?.isDepartmentHead && (me as any)?.departmentId) {
      const peers = await this.ctx.prisma.bitrixUserMapping.findMany({
        where: { departmentId: (me as any).departmentId },
      });
      for (const p of peers as any[]) {
        if (p.userId !== viewerId) result.add(p.userId);
      }
    }

    // Un override explícito de otro jefe gana sobre la jerarquía de Bitrix.
    if (result.size > 0) {
      const reassigned = await this.ctx.prisma.userProfileOverride.findMany({
        where: { userId: { in: [...result] }, NOT: { managerUserId: viewerId } },
      });
      for (const r of reassigned as any[]) {
        if (r.managerUserId) result.delete(r.userId);
      }
    }

    return result;
  }

  async countryOf(userId: string): Promise<string> {
    const override = await this.ctx.prisma.userProfileOverride.findUnique({ where: { userId } });
    if ((override as any)?.country) return (override as any).country;
    const mapping = await this.ctx.prisma.bitrixUserMapping.findUnique({ where: { userId } });
    return (mapping as any)?.country ?? this.defaultCountry();
  }

  async countryByUserId(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();

    const [overrides, mappings] = await Promise.all([
      this.ctx.prisma.userProfileOverride.findMany({ where: { userId: { in: userIds } } }),
      this.ctx.prisma.bitrixUserMapping.findMany({ where: { userId: { in: userIds } } }),
    ]);
    const byOverride = new Map((overrides as any[]).map(o => [o.userId, o.country]));
    const byMapping = new Map((mappings as any[]).map(m => [m.userId, m.country]));

    const result = new Map<string, string>();
    for (const id of userIds) {
      result.set(id, byOverride.get(id) || byMapping.get(id) || this.defaultCountry());
    }
    return result;
  }

  async setOverride(
    userId: string,
    data: { managerUserId?: string | null; country?: string | null },
  ): Promise<void> {
    await this.ctx.prisma.userProfileOverride.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }
}
