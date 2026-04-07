import type { PluginContext } from '@vla/plugin-sdk';

export interface Zone {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  id: string;
  name: string;
  isActive: boolean;
  zones: Zone[];
}

/**
 * Manages office layout definitions (rooms, zones, positions).
 */
export class LayoutService {
  constructor(private readonly ctx: PluginContext) {}

  async getActive(): Promise<Layout | null> {
    const layout = await this.ctx.prisma.officeLayout.findFirst({
      where: { isActive: true },
      include: { zones: true },
    });
    return layout ? this.toLayout(layout) : null;
  }

  async getAll(): Promise<Layout[]> {
    const layouts = await this.ctx.prisma.officeLayout.findMany({
      include: { zones: true },
      orderBy: { createdAt: 'asc' },
    });
    return layouts.map((l: any) => this.toLayout(l));
  }

  async create(name: string): Promise<Layout> {
    // Deactivate all others and create new active layout
    await this.ctx.prisma.officeLayout.updateMany({ data: { isActive: false } });
    const layout = await this.ctx.prisma.officeLayout.create({
      data: { name, isActive: true },
      include: { zones: true },
    });
    return this.toLayout(layout);
  }

  async addZone(layoutId: string, zone: Omit<Zone, 'id'>): Promise<Zone> {
    const created = await this.ctx.prisma.officeZone.create({
      data: { layoutId, ...zone },
    });
    return this.toZone(created);
  }

  async moveUser(userId: string, zoneId: string, x: number, y: number): Promise<void> {
    await this.ctx.prisma.officeZoneUser.upsert({
      where: { userId },
      create: { userId, zoneId, positionX: x, positionY: y },
      update: { zoneId, positionX: x, positionY: y },
    });
    await this.ctx.hooks.doAction('office.user.moved', { userId, zoneId, positionX: x, positionY: y });
  }

  async getUserPositions(): Promise<{ userId: string; zoneId: string; x: number; y: number }[]> {
    const positions = await this.ctx.prisma.officeZoneUser.findMany();
    return positions.map((p: any) => ({
      userId: p.userId,
      zoneId: p.zoneId,
      x: p.positionX,
      y: p.positionY,
    }));
  }

  private toLayout(l: any): Layout {
    return {
      id: l.id,
      name: l.name,
      isActive: l.isActive,
      zones: (l.zones ?? []).map((z: any) => this.toZone(z)),
    };
  }

  private toZone(z: any): Zone {
    return { id: z.id, name: z.name, type: z.type, x: z.x, y: z.y, width: z.width, height: z.height };
  }
}
