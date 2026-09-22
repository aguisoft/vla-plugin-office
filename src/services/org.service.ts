import type { PluginContext } from '@vla/plugin-sdk';
import { resolveCountry, resolveManager, type CountrySource, type ManagerSource } from '../lib/country-source';

export interface RosterEntry {
  userId: string;
  country: string;
  countrySource: CountrySource;
  managerUserId: string | null;
  managerSource: ManagerSource;
}

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
    // Nadie es su propio jefe, tampoco vía override: PUT /org/:userId ya lo
    // rechaza con 400, pero managerOf no debe depender de que ese sea el
    // único escritor (import masivo, script, edición directa en la base).
    if ((override as any)?.managerUserId && (override as any).managerUserId !== userId) {
      return (override as any).managerUserId;
    }

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

  /**
   * País y jefe de TODOS los usuarios pedidos, con dos consultas en total.
   *
   * `countryByUserId` + `managerOf` por persona costaba 2 consultas por cabeza
   * (70 para los 35 de producción) y además `countryByUserId` no dice de dónde
   * salió el valor. La pantalla de feriados necesita el origen: un "CR" que
   * significa "nadie cargó el dato" no puede verse igual que uno verificado.
   */
  async roster(userIds: string[]): Promise<Map<string, RosterEntry>> {
    const result = new Map<string, RosterEntry>();
    if (userIds.length === 0) return result;

    const [overrides, mappings] = await Promise.all([
      this.ctx.prisma.userProfileOverride.findMany({ where: { userId: { in: userIds } } }),
      // Sin filtro de userId a propósito: el jefe de un departamento puede no
      // estar en `userIds` (p. ej. si se pide un subconjunto), y sin su fila
      // headByDept quedaría incompleto y el jefe saldría null.
      this.ctx.prisma.bitrixUserMapping.findMany(),
    ]);

    const overrideOf = new Map((overrides as any[]).map(o => [o.userId, o]));
    const mappingOf  = new Map((mappings as any[]).map(m => [m.userId, m]));

    const headByDept = new Map<string, string>();
    for (const m of mappings as any[]) {
      if (m.isDepartmentHead && m.departmentId && !headByDept.has(m.departmentId)) {
        headByDept.set(m.departmentId, m.userId);
      }
    }

    const fallback = this.defaultCountry();
    for (const id of userIds) {
      const o = overrideOf.get(id) as any;
      const m = mappingOf.get(id) as any;
      const { country, source } = resolveCountry(o?.country, m?.country, fallback);
      const { managerUserId, source: managerSource } = resolveManager(id, o?.managerUserId, m?.departmentId, headByDept);
      result.set(id, {
        userId: id,
        country,
        countrySource: source,
        managerUserId,
        managerSource,
      });
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
