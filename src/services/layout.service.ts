import type { PluginContext } from '@vla/plugin-sdk';

export interface Zone {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  icon?: string;
  maxOccupancy?: number | null;
}

export interface Layout {
  id: string;
  name: string;
  isActive: boolean;
  zones: Zone[];
}

/**
 * Manages office layout definitions (rooms, zones, positions).
 * Zones are stored as JSON inside OfficeLayout.zones.
 * User positions are stored in PresenceStatus (currentZoneId, positionX, positionY).
 */
export class LayoutService {
  constructor(private readonly ctx: PluginContext) {}

  async getActive(): Promise<Layout | null> {
    const layout = await this.ctx.prisma.officeLayout.findFirst({
      where: { isActive: true },
    });
    return layout ? this.toLayout(layout) : null;
  }

  async getAll(): Promise<Layout[]> {
    const layouts = await this.ctx.prisma.officeLayout.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return layouts.map((l: any) => this.toLayout(l));
  }

  async create(name: string): Promise<Layout> {
    await this.ctx.prisma.officeLayout.updateMany({ data: { isActive: false } });
    const layout = await this.ctx.prisma.officeLayout.create({
      data: { name, isActive: true, zones: [] },
    });
    return this.toLayout(layout);
  }

  async addZone(layoutId: string, zone: Omit<Zone, 'id'>): Promise<Zone> {
    const layout = await this.ctx.prisma.officeLayout.findUnique({ where: { id: layoutId } });
    if (!layout) throw new Error('Layout not found');

    const zones: Zone[] = Array.isArray(layout.zones) ? (layout.zones as any[]) : [];
    const newZone: Zone = { id: `zone_${Date.now()}`, ...zone };
    zones.push(newZone);

    await this.ctx.prisma.officeLayout.update({
      where: { id: layoutId },
      data: { zones },
    });

    return newZone;
  }

  async moveUser(userId: string, zoneId: string, x: number, y: number): Promise<void> {
    await this.ctx.prisma.presenceStatus.upsert({
      where: { userId },
      create: { userId, currentZoneId: zoneId, positionX: x, positionY: y },
      update: { currentZoneId: zoneId, positionX: x, positionY: y },
    });
    await this.ctx.hooks.doAction('office.user.moved', { userId, zoneId, positionX: x, positionY: y });
  }

  async getUserPositions(): Promise<{ userId: string; zoneId: string; x: number; y: number; isDefault: boolean }[]> {
    const statuses = await this.ctx.prisma.presenceStatus.findMany({
      where: { OR: [{ currentZoneId: { not: null } }, { defaultZoneId: { not: null } }] },
    });
    return statuses
      .filter((p: any) => p.currentZoneId != null || p.defaultZoneId != null)
      .map((p: any) => ({
        userId: p.userId,
        zoneId: p.currentZoneId ?? p.defaultZoneId,
        x: p.positionX ?? 0,
        y: p.positionY ?? 0,
        isDefault: p.currentZoneId == null,
      }));
  }

  private toLayout(l: any): Layout {
    const zones: Zone[] = Array.isArray(l.zones) ? (l.zones as Zone[]) : [];
    return {
      id: l.id,
      name: l.name,
      isActive: l.isActive,
      zones,
    };
  }
}
