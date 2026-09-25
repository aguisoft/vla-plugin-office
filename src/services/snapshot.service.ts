import type { PluginContext } from '@vla/plugin-sdk';
import type { BitrixService } from './bitrix.service';
import type { AbsenceService } from './absence.service';
import type { HolidayService } from './holiday.service';
import type { OrgService } from './org.service';
import { resolveStatus } from '../lib/state-resolver';
import { canSeeJustification } from '../lib/justification-visibility';
import { DEFAULT_TZ } from '../lib/local-date';

export interface UserSnapshot {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isCheckedIn: boolean;
  /** Estado resuelto: ya incluye ausencias y feriados. */
  status: string;
  /** PresenceStatus.status sin resolver. Para diagnosticar. */
  rawStatus: string;
  /** El estado viene de una ausencia o un feriado. */
  isAbsent: boolean;
  /** Omitido si el viewer no tiene permiso de verla. */
  justification?: string;
  statusStartsAt?: string;
  statusEndsAt?: string;
  absenceEndsAt?: string;
  meetingId?: string;
  meetingWith?: { userId: string; firstName: string; lastName: string }[];
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
    private readonly absences: AbsenceService,
    private readonly holidays: HolidayService,
    private readonly org: OrgService,
    private readonly bitrix?: BitrixService,
    private readonly pluginApiBase = '/api/v1/p/office',
    // Función, no string: ctx.plugin.config se hidrata después de registrar.
    private readonly tzOf: () => string = () => DEFAULT_TZ,
  ) {}

  async getAll(viewer: { userId: string; hasManage: boolean }): Promise<UserSnapshot[]> {
    const now = new Date();
    const viewerId = viewer.userId;

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

    const userIds = (users as any[]).map(u => u.id);

    // Un query por concepto para toda la oficina, no uno por persona.
    // hasManage llega ya resuelto desde el endpoint: el servicio no tiene el
    // req, así que no puede consultar permisos por su cuenta.
    const [activeAbsences, countryOf, managedUserIds] = await Promise.all([
      this.absences.activeByUserId(now),
      this.org.countryByUserId(userIds),
      this.org.managedUserIds(viewerId),
    ]);
    const onHoliday = await this.holidays.effectiveByUserId(now, countryOf, this.tzOf());

    const viewerCtx = { userId: viewerId, hasManage: viewer.hasManage, managedUserIds };

    const presenceMap = new Map((presences as any[]).map(p => [p.userId, p]));
    const avatarMap   = new Map((avatars as any[]).map(a => [a.userId, a]));
    const checkInMap  = new Map<string, any>();
    for (const r of openCheckIns as any[]) {
      if (!checkInMap.has(r.userId)) checkInMap.set(r.userId, r);
    }

    const photoMap = this.bitrix
      ? await this.bitrix.getAllPhotoUrls(userIds)
      : new Map<string, string>();

    // Zona efectiva del mapa: la fijada a mano, y si no hay, la que sugiere el
    // nombre del departamento. Sin esto, corregir el departamento de alguien no
    // lo movía en el mapa y el cambio parecía no haber surtido efecto.
    // Degrada a las zonas ya guardadas si falla: el mapa se dibuja igual.
    let zoneOf = new Map<string, string | null>();
    try {
      zoneOf = await this.org.zoneByUserId(userIds);
    } catch (e) {
      this.ctx.logger.warn(`No se pudo resolver la zona del mapa: ${e}`);
    }

    // Participantes de las reuniones internas que están abiertas.
    const meetingIds = [...new Set(
      (presences as any[]).map(p => p.meetingId).filter(Boolean),
    )];
    const participantsByMeeting = await this.loadMeetingParticipants(meetingIds, users as any[]);

    const out: UserSnapshot[] = [];
    for (const u of users as any[]) {
      const p = presenceMap.get(u.id) as any;
      const a = avatarMap.get(u.id) as any;
      const absence = activeAbsences.get(u.id);

      const resolved = resolveStatus({
        presenceStatus: (p?.status ?? 'OFFLINE') as any,
        presenceJustification: p?.justification ?? null,
        absences: absence ? [absence] : [],
        isHolidayToday: onHoliday.has(u.id),
        now,
      });

      // La justificación de un feriado movido vive en el override, y ya
      // llegó resuelta en el mismo query por lotes de effectiveByUserId más
      // arriba — no una llamada más a la base por persona en este ciclo.
      let justification = resolved.justification;
      if (resolved.status === 'FERIADO') {
        justification = onHoliday.get(u.id) ?? null;
      }

      const snap: UserSnapshot = {
        userId: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        role: u.role,
        isCheckedIn: p?.isCheckedIn ?? false,
        status: resolved.status,
        rawStatus: p?.status ?? 'OFFLINE',
        isAbsent: resolved.isAbsent,
        statusStartsAt: p?.statusStartsAt?.toISOString(),
        statusEndsAt:   p?.statusEndsAt?.toISOString(),
        absenceEndsAt:  resolved.absenceEndsAt?.toISOString(),
        meetingId:      p?.meetingId ?? undefined,
        meetingWith:    p?.meetingId
          ? participantsByMeeting.get(p.meetingId)?.filter(m => m.userId !== u.id)
          : undefined,
        currentZoneId: p?.currentZoneId ?? undefined,
        // La resuelta, no la cruda: incluye la sugerida por departamento.
        defaultZoneId: zoneOf.get(u.id) ?? p?.defaultZoneId ?? undefined,
        positionX: p?.positionX ?? undefined,
        positionY: p?.positionY ?? undefined,
        lastActivityAt: (p?.lastActivityAt ?? now).toISOString(),
        checkedInAt: checkInMap.get(u.id)?.checkInAt?.toISOString(),
        photoUrl: photoMap.has(u.id) ? `${this.pluginApiBase}/photo/${u.id}` : undefined,
        avatar: a ? {
          skinColor: a.skinColor, hairStyle: a.hairStyle, hairColor: a.hairColor,
          shirtColor: a.shirtColor, accessory: a.accessory, emoji: a.emoji ?? undefined,
        } : null,
      };

      // El campo se OMITE, no se manda vacío: el texto no viaja sin permiso.
      if (justification && canSeeJustification(viewerCtx, u.id, resolved.status)) {
        snap.justification = justification;
      }

      out.push(snap);
    }

    return out;
  }

  /**
   * Participantes de cada reunión activa: el host + los invitados ACCEPTED.
   * El host no tiene fila propia en MeetingInvite (es quien crea las filas de
   * los demás), así que hay que agregarlo aparte o `meetingWith` nunca lo
   * menciona en la tarjeta de sus invitados. Se deriva de cualquier fila de
   * esa reunión (todas comparten `hostId` sin importar su estado — incluso
   * si nadie aceptó todavía, o si algunas ya fueron declinadas).
   *
   * `getAll` filtra al propio usuario renderizado antes de asignar
   * `meetingWith`: sin eso, la tarjeta de un invitado que aceptó se leía a sí
   * mismo en la lista ("Con Beto" en la tarjeta de Beto) y nunca mencionaba
   * al anfitrión.
   */
  private async loadMeetingParticipants(
    meetingIds: string[],
    users: { id: string; firstName: string; lastName: string }[],
  ): Promise<Map<string, { userId: string; firstName: string; lastName: string }[]>> {
    const result = new Map<string, { userId: string; firstName: string; lastName: string }[]>();
    if (!meetingIds.length) return result;

    const invites = await this.ctx.prisma.meetingInvite.findMany({
      where: { meetingId: { in: meetingIds } },
    });
    const nameOf = new Map(users.map(u => [u.id, u]));

    const hostIdByMeeting = new Map<string, string>();
    for (const i of invites as any[]) {
      if (!hostIdByMeeting.has(i.meetingId)) hostIdByMeeting.set(i.meetingId, i.hostId);
    }
    for (const [meetingId, hostId] of hostIdByMeeting) {
      const h = nameOf.get(hostId);
      if (h) result.set(meetingId, [{ userId: h.id, firstName: h.firstName, lastName: h.lastName }]);
    }

    for (const i of invites as any[]) {
      if (i.state !== 'ACCEPTED') continue;
      const u = nameOf.get(i.inviteeId);
      if (!u) continue;
      const list = result.get(i.meetingId) ?? [];
      list.push({ userId: u.id, firstName: u.firstName, lastName: u.lastName });
      result.set(i.meetingId, list);
    }
    return result;
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
