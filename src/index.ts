import type { PluginDefinition } from '@vla/plugin-sdk';
import { PresenceService } from './services/presence.service';
import { LayoutService } from './services/layout.service';
import { SnapshotService } from './services/snapshot.service';
import { BitrixService } from './services/bitrix.service';
import { AbsenceService } from './services/absence.service';
import { OrgService } from './services/org.service';
import { HolidayService } from './services/holiday.service';
import { MeetingService } from './services/meeting.service';
import { RESTRICTED_ABSENCES } from './lib/absence-validation';
import { DEFAULT_TZ } from './lib/local-date';
import { validateStatusInput, type StatusInput, type OfficeStatus } from './lib/status-rules';

const PERMS = {
  VIEW:     'office.view',
  CHECKIN:  'office.checkin',
  MANAGE:   'office.manage',
} as const;

/**
 * Los permisos ya vienen resueltos en el request (req.user.permissions);
 * el SDK no expone un chequeo imperativo, así que este helper es el único
 * punto donde se decide "puede o no puede" fuera de ctx.requirePermission.
 */
function can(req: any, permission: string): boolean {
  if (req.user?.role === 'ADMIN') return true;
  return (req.user?.permissions ?? []).includes(permission);
}

const plugin: PluginDefinition = {
  async register(ctx) {
    ctx.logger.log('Office plugin iniciado');

    // ── Register plugin capabilities ──────────────────────────────────────────
    ctx.hooks.registerFilter('core.permissions.register', (map: any) => ({
      ...map,
      [PERMS.VIEW]:    { label: 'Ver oficina virtual',      group: 'Oficina Virtual', plugin: ctx.plugin.name },
      [PERMS.CHECKIN]: { label: 'Hacer check-in/check-out', group: 'Oficina Virtual', plugin: ctx.plugin.name },
      [PERMS.MANAGE]:  { label: 'Administrar layouts',      group: 'Oficina Virtual', plugin: ctx.plugin.name },
    }));

    ctx.hooks.registerFilter('core.roles.preset', (roles: any[]) => [
      ...roles,
      {
        name: 'Colaborador',
        description: 'Acceso básico a la oficina virtual con check-in',
        permissions: [PERMS.VIEW, PERMS.CHECKIN],
        color: '#10b981',
        plugin: ctx.plugin.name,
      },
    ]);

    const presence = new PresenceService(ctx);
    const layout   = new LayoutService(ctx);
    const bitrix   = new BitrixService(ctx);
    const absences = new AbsenceService(ctx);
    const tz = () => (ctx.plugin.config.TIMEZONE as string) || DEFAULT_TZ;
    const org = new OrgService(ctx, () => (ctx.plugin.config.DEFAULT_COUNTRY as string) || 'CR');
    const holidays = new HolidayService(ctx);
    const meetings = new MeetingService(
      ctx,
      (userId, payload) => presence.broadcastToUser(userId, payload),
      (userId) => presence.updateStatus(userId, 'AVAILABLE').then(() => undefined),
    );
    // Cierra el ciclo presence ↔ meetings sin dependencia circular en el
    // constructor: checkIn/checkOut ahora liberan reuniones automáticamente,
    // y con eso el cron de inactividad y el webhook de Bitrix (que solo
    // llaman checkIn/checkOut) heredan el release sin tocarlos. Ver Fix #1.
    presence.setMeetingReleaser((userId) => meetings.releaseUser(userId));
    // Instanciado después de absences/holidays/org: los recibe en el constructor.
    const snapshot = new SnapshotService(ctx, absences, holidays, org, bitrix, undefined, tz);

    // Sync Bitrix photos + timeman on startup — delayed 5s to let hydrateConfig complete first
    setTimeout(async () => {
      try {
        await bitrix.syncPhotos();
      } catch (e) { ctx.logger.warn(`Bitrix startup syncPhotos: ${e}`); }
      try {
        const r = await runTimemanSync();
        ctx.logger.log(`Bitrix startup timeman sync: ${r.synced} actualizados`);
      } catch (e) { ctx.logger.warn(`Bitrix startup syncTimeman: ${e}`); }
    }, 5000);

    // ── Real-time SSE ──────────────────────────────────────────────────────────
    ctx.router.get('/events', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const unsubscribe = presence.subscribe((data) => res.write(data), (req as any).user?.sub ?? null);
      req.on('close', unsubscribe);
    });

    // ── Presencia ──────────────────────────────────────────────────────────────

    ctx.router.get('/presence', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), async (_req, res) => {
      res.json(await presence.getAll());
    });

    ctx.router.get('/presence/all', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), async (_req, res) => {
      res.json(await presence.getAllIncludingOffline());
    });

    ctx.router.get('/presence/:userId', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), async (req, res) => {
      const record = await presence.getOne(req.params.userId);
      if (!record) return res.status(404).json({ message: 'Usuario no encontrado' });
      res.json(record);
    });

    ctx.router.patch('/presence/status', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const body = req.body as StatusInput;

      const errors = validateStatusInput(body, tz());
      if (errors.length) {
        return res.status(400).json({ message: 'Datos inválidos', errors });
      }
      const status = body.status as OfficeStatus;

      // ── Participantes: el host no se incluye y nadie puede estar ausente ──
      const participantIds = (body.participantIds ?? []).filter(id => id !== userId);
      if (participantIds.length) {
        const active = await absences.activeByUserId(new Date());
        const countryOf = await org.countryByUserId(participantIds);
        const onHoliday = await holidays.effectiveByUserId(new Date(), countryOf, tz());

        const blocked = participantIds.filter(id => active.has(id) || onHoliday.has(id));
        if (blocked.length) {
          const names = await ctx.prisma.user.findMany({
            where: { id: { in: blocked } },
            select: { id: true, firstName: true, lastName: true },
          });
          return res.status(400).json({
            message: 'No se puede invitar a colaboradores ausentes',
            unavailable: (names as any[]).map(u => {
              const a = active.get(u.id);
              return {
                userId: u.id,
                name: `${u.firstName} ${u.lastName}`,
                reason: a?.type ?? 'FERIADO',
                until: a?.endAt ?? null,
              };
            }),
          });
        }
      }

      // ── Salir de la reunión anterior si había una ──
      // Dos casos distintos y los dos hacen falta: si el usuario hospedaba
      // una reunión, se cancela y quien la había aceptado vuelve a AVAILABLE;
      // si el usuario era el invitado que había aceptado, esa fila se cierra
      // para que `meetingWith` del host deje de listarlo. La misma cadena
      // corre también en checkIn/checkOut (heredada por cron y webhook de
      // Bitrix) y en el handler de aceptar invitación — ver
      // MeetingService.releaseUser.
      await meetings.releaseUser(userId);

      let meetingId: string | null = null;
      if (status === 'IN_MEETING_INTERNAL' && participantIds.length) {
        const justification = body.justification!.trim();
        ({ meetingId } = await meetings.invite(userId, participantIds, justification));
      }

      await presence.setManualOverride(userId);
      const record = await presence.updateStatus(userId, status, {
        justification: body.justification?.trim() || null,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        meetingId,
      });
      res.json(record);
    });

    // ── Check-in / Check-out manual ────────────────────────────────────────────

    ctx.router.post('/checkin', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      await presence.setManualOverride(userId);
      const record = await presence.checkIn(userId, 'WEB');
      // Sync with Bitrix timeman (fire-and-forget)
      bitrix.getBitrixIdForVlaUser(userId).then(bid => {
        if (bid) bitrix.timemanOpen(bid).then(ok =>
          ctx.logger.log(`timeman.open bitrixId=${bid} → ${ok ? 'OK' : 'FAIL'}`));
      }).catch(e => ctx.logger.warn(`timeman.open lookup error: ${e}`));
      res.json(record);
    });

    ctx.router.post('/checkout', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      await presence.setManualOverride(userId);
      await presence.checkOut(userId, 'WEB');
      // Sync with Bitrix timeman (fire-and-forget)
      bitrix.getBitrixIdForVlaUser(userId).then(bid => {
        if (bid) bitrix.timemanClose(bid).then(ok =>
          ctx.logger.log(`timeman.close bitrixId=${bid} → ${ok ? 'OK' : 'FAIL'}`));
      }).catch(e => ctx.logger.warn(`timeman.close lookup error: ${e}`));
      res.json({ ok: true });
    });

    // ── Ausencias (permiso, vacaciones, incapacidad) ───────────────────────────
    // El body.startAt/endAt cambia de forma según el type (AbsenceInput en
    // absence-validation.ts): PERMISO manda instante real; VACACIONES/
    // INCAPACIDAD mandan fecha PURA "YYYY-MM-DD" que el servidor ancla a la
    // zona de la operación (ver absence-bounds.ts). No es simetría por
    // gusto: es la corrección de la regresión donde el navegador convertía
    // esas dos fechas a instante con SU zona antes de mandarlas.

    ctx.router.post('/absences', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), async (req, res) => {
      const requesterId = (req as any).user?.sub;
      if (!requesterId) return res.status(401).json({ message: 'Unauthorized' });

      // Registrar por otra persona exige office.manage
      const targetUserId = (req.body.userId as string) || requesterId;
      if (targetUserId !== requesterId && !can(req, PERMS.MANAGE)) {
        return res.status(403).json({ message: 'Solo office.manage puede registrar ausencias de otros' });
      }

      const result = await absences.create(targetUserId, req.body, requesterId, tz());
      if ('errors' in result) return res.status(400).json({ message: 'Datos inválidos', errors: result.errors });
      if ('conflict' in result) {
        return res.status(409).json({
          message: 'Ya hay una ausencia registrada en ese rango',
          conflict: result.conflict,
        });
      }
      res.status(201).json({ id: result.id });
    });

    // Ausencias de uno mismo (por defecto) o de ?userId= si quien pregunta es
    // su jefe directo o tiene office.manage. La justificación de PERMISO e
    // INCAPACIDAD (datos médicos/personales) se omite del payload si no
    // corresponde verla — nunca viaja vacía, el campo directamente no está.
    ctx.router.get('/absences', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), async (req, res) => {
      const requesterId = (req as any).user?.sub;
      if (!requesterId) return res.status(401).json({ message: 'Unauthorized' });

      const targetUserId = (req.query.userId as string) || requesterId;
      const canSeeRestricted =
        targetUserId === requesterId ||
        can(req, PERMS.MANAGE) ||
        await org.isManagerOf(requesterId, targetUserId);

      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const rows = await absences.listForUserDetailed(targetUserId, from, to);

      res.json(rows.map(a => {
        if (RESTRICTED_ABSENCES.has(a.type) && !canSeeRestricted) {
          const { justification, ...rest } = a;
          return rest;
        }
        return a;
      }));
    });

    ctx.router.delete('/absences/:id', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), async (req, res) => {
      const requesterId = (req as any).user?.sub;
      if (!requesterId) return res.status(401).json({ message: 'Unauthorized' });
      const canManage = can(req, PERMS.MANAGE);
      const done = await absences.remove(req.params.id, requesterId, canManage);
      if (!done) return res.status(404).json({ message: 'Ausencia no encontrada' });
      res.status(204).end();
    });

    // ── Feriados (calendario por país + override personal) ────────────────────

    ctx.router.get('/holidays', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), async (req, res) => {
      const year = req.query.year ? Number(req.query.year) : undefined;
      res.json(await holidays.list(year, req.query.country as string | undefined));
    });

    ctx.router.post('/holidays', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), async (req, res) => {
      const { date, name, country } = req.body as { date: string; name: string; country: string };
      if (!date || !name || !country) {
        return res.status(400).json({ message: 'date, name y country son obligatorios' });
      }
      const parsed = new Date(date);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ message: 'Fecha inválida' });
      }
      try {
        res.status(201).json({ id: await holidays.create(parsed, name, country) });
      } catch {
        res.status(409).json({ message: 'Ya existe un feriado en esa fecha para ese país' });
      }
    });

    ctx.router.delete('/holidays/:id', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), async (req, res) => {
      const done = await holidays.remove(req.params.id);
      if (!done) return res.status(404).json({ message: 'Feriado no encontrado' });
      res.status(204).end();
    });

    // Feriados que el colaborador todavía puede mover
    ctx.router.get('/holidays/movable', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const country = await org.countryOf(userId);
      res.json(await holidays.movableForUser(userId, country));
    });

    ctx.router.post('/holidays/:id/override', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const { newDate, justification } = req.body as { newDate: string; justification: string };
      // country es el país RESUELTO HOY del colaborador (org.countryOf), no un
      // dato que venga del body: es la defensa en la escritura contra mover un
      // feriado que no le corresponde (ver holiday.service.ts).
      const country = await org.countryOf(userId);
      const result = await holidays.setOverride(
        userId, req.params.id, new Date(newDate), justification ?? '', country, tz(),
      );
      if (!result.ok) return res.status(400).json({ message: 'Datos inválidos', errors: result.errors });
      res.status(201).json({ ok: true });
    });

    ctx.router.delete('/holidays/:id/override', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const done = await holidays.clearOverride(userId, req.params.id);
      if (!done) return res.status(404).json({ message: 'No hay override para ese feriado' });
      res.status(204).end();
    });

    // ── Invitaciones a reunión ──────────────────────────────────────────────
    // El anfitrión entra a la reunión de inmediato desde PATCH /presence/status
    // (Task 16, que llama meetings.invite); acá solo vive el lado del invitado:
    // ver sus invitaciones pendientes y responder. cancel es del anfitrión, no
    // se expone como endpoint del invitado — ver meeting-invites.ts.

    ctx.router.get('/meetings/invites', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      res.json(await meetings.pendingFor(userId));
    });

    for (const action of ['accept', 'decline'] as const) {
      ctx.router.post(`/meetings/invites/:id/${action}`, ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), async (req, res) => {
        const userId = (req as any).user?.sub;
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        const result = await meetings.respond(req.params.id, userId, action);
        if (!result.ok) {
          const code = result.reason === 'not_found' ? 404
                     : result.reason === 'not_yours' ? 403 : 409;
          return res.status(code).json({ message: reasonMessage(result.reason) });
        }

        if (action === 'accept') {
          // Libera cualquier reunión propia previa antes de instalar el
          // nuevo estado: si quien acepta hospedaba una, sus invitados
          // vuelven a AVAILABLE; si venía de otra invitación aceptada, esa
          // fila se cancela. Sin esto, un host que acepta una invitación
          // ajena deja varados para siempre a los que había invitado (el
          // caso concreto: B hospeda M1 con C aceptado, B acepta una
          // invitación a M2, y C se queda en IN_MEETING_INTERNAL sin
          // reunión real). `respond()` ya dejó ESTA invitación en ACCEPTED
          // arriba, así que se excluye por id — si no, releaseUser la
          // cancelaría a sí misma.
          await meetings.releaseUser(userId, req.params.id);

          // Hereda la justificación y el meetingId del host.
          const hostPresence = await ctx.prisma.presenceStatus.findUnique({
            where: { userId: result.hostId },
          });
          await presence.updateStatus(userId, 'IN_MEETING_INTERNAL', {
            justification: (hostPresence as any)?.justification ?? null,
            meetingId: result.meetingId,
          });
        }
        res.json({ ok: true });
      });
    }

    // NO hay endpoint /leave. La salida voluntaria del invitado es simplemente
    // cambiar de estado con el selector, y el PATCH /presence/status de la
    // Task 16 se encarga de cerrar su fila de MeetingInvite. Un endpoint aparte
    // sería salteable y exigiría una UI que el spec no pide.

    // ── Snapshot (users + presence + avatars + bitrix photos) ─────────────────

    ctx.router.get('/snapshot', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), async (req, res) => {
      const snap = await snapshot.getAll({
        userId: (req as any).user.sub,
        hasManage: can(req, PERMS.MANAGE),
      });
      res.json(snap);
    });

    // ── Photo proxy (avoids browser CDN/CORS issues with Bitrix URLs) ──────────
    ctx.router.get('/photo/:userId', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), async (req, res) => {
      const rawUrl = await bitrix.getPhotoUrl(req.params.userId);
      if (!rawUrl) return res.status(404).end();
      try {
        const safeUrl = rawUrl.replace(/ /g, '%20');
        const upstream = await fetch(safeUrl);
        if (!upstream.ok) return res.status(404).end();
        const ct = upstream.headers.get('content-type') ?? 'image/jpeg';
        res.setHeader('Content-Type', ct);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        const buf = await upstream.arrayBuffer();
        res.send(Buffer.from(buf));
      } catch {
        res.status(500).end();
      }
    });

    ctx.router.patch('/me/avatar', ctx.requireAuth(), async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      await snapshot.updateAvatar(userId, req.body);
      res.json({ ok: true });
    });

    // ── Bitrix24 ──────────────────────────────────────────────────────────────

    // Webhook entrante (check-in/out desde Bitrix)
    ctx.router.post('/bitrix/webhook', async (req, res) => {
      const event = req.body?.event as string;
      const bitrixUserId = String(req.body?.data?.USER_ID ?? '');
      const secret = ctx.plugin.config?.bitrixWebhookSecret as string | undefined;

      if (secret && req.headers['x-webhook-secret'] !== secret) {
        return res.status(401).json({ message: 'Unauthorized' });
      }
      if (!event || !bitrixUserId) {
        return res.status(400).json({ message: 'Missing event or USER_ID' });
      }

      const mapping = await ctx.prisma.bitrixUserMapping.findFirst({
        where: { bitrixUserId: parseInt(bitrixUserId, 10) },
      });
      if (!mapping) {
        ctx.logger.warn(`Bitrix userId ${bitrixUserId} sin mapeo VLA`);
        return res.json({ ok: true, mapped: false });
      }

      if (event === 'ONTIMEMANOPEN') {
        await presence.checkIn(mapping.userId, 'BITRIX');
      } else if (event === 'ONTIMEMANCLOSE') {
        await presence.checkOut(mapping.userId, 'BITRIX');
      }

      res.json({ ok: true });
    });

    // Debug: timeman status por usuario (admin)
    ctx.router.get('/bitrix/debug-timeman', ctx.requireAuth('ADMIN'), async (_req, res) => {
      res.json(await bitrix.debugTimeman());
    });

    // Sincronización manual de fotos (admin)
    ctx.router.post('/bitrix/sync', ctx.requireAuth('ADMIN'), async (_req, res) => {
      const result = await bitrix.syncPhotos();
      res.json({ ok: true, ...result });
    });

    // Sincronización manual de timeman (admin)
    ctx.router.post('/bitrix/sync-timeman', ctx.requireAuth('ADMIN'), async (_req, res) => {
      const result = await runTimemanSync();
      res.json({ ok: true, ...result });
    });

    // ── Organigrama (jefe directo, país) ───────────────────────────────────────

    ctx.router.get('/org/:userId', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), async (req, res) => {
      const { userId } = req.params;
      res.json({
        userId,
        managerUserId: await org.managerOf(userId),
        country: await org.countryOf(userId),
      });
    });

    ctx.router.put('/org/:userId', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), async (req, res) => {
      const { managerUserId, country } = req.body as { managerUserId?: string | null; country?: string | null };
      if (managerUserId === req.params.userId) {
        return res.status(400).json({ message: 'Nadie puede ser su propio jefe' });
      }
      await org.setOverride(req.params.userId, { managerUserId, country });
      res.json({ ok: true });
    });

    // Diagnóstico: cuántos usuarios traen país/jefe de Bitrix (admin funcional).
    // syncOrgStructure() nunca lanza — si Bitrix está inalcanzable devuelve
    // { synced: 0, heads: 0, withCountry: 0 } y queda logueado como warning.
    ctx.router.post('/org/sync', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), async (_req, res) => {
      res.json(await bitrix.syncOrgStructure());
    });

    // Diagnóstico de SOLO LECTURA: mide si vale la pena inferir el país del
    // teléfono cuando PERSONAL_COUNTRY viene vacío. No escribe nada y no expone
    // ni un número: solo formas, prefijos y conteos.
    //
    // Es GET a propósito, para que no pueda confundirse con una acción. Y va
    // con office.manage porque agrega datos de toda la organización.
    ctx.router.get('/org/country-coverage', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), async (_req, res) => {
      res.json(await bitrix.countryCoverageReport());
    });

    // ── Layout ────────────────────────────────────────────────────────────────

    ctx.router.get('/layout', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), async (_req, res) => {
      const active = await layout.getActive();
      const positions = await layout.getUserPositions();
      res.json({ layout: active, positions });
    });

    ctx.router.get('/layout/all', ctx.requireAuth('ADMIN'), async (_req, res) => {
      res.json(await layout.getAll());
    });

    ctx.router.post('/layout', ctx.requireAuth('ADMIN'), async (req, res) => {
      const { name } = req.body as { name: string };
      if (!name) return res.status(400).json({ message: 'name is required' });
      res.status(201).json(await layout.create(name));
    });

    ctx.router.post('/layout/:id/zones', ctx.requireAuth('ADMIN'), async (req, res) => {
      const zone = await layout.addZone(req.params.id, req.body as any);
      res.status(201).json(zone);
    });

    ctx.router.patch('/layout/position', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const { zoneId, x, y } = req.body as { zoneId: string; x: number; y: number };
      await layout.moveUser(userId, zoneId, x, y);
      res.json({ ok: true });
    });

    // ── Hooks ─────────────────────────────────────────────────────────────────

    ctx.hooks.registerAction('core.user.created', async ({ user }: { user: { id: string } }) => {
      await ctx.prisma.presenceStatus.upsert({
        where: { userId: user.id },
        create: { userId: user.id, isCheckedIn: false, status: 'OFFLINE' },
        update: {},
      });
    });

    ctx.hooks.declareHook('office.user.checked_in', {
      description: 'Un usuario entró a la oficina virtual',
      payload: { userId: 'string', source: 'WEB | BITRIX | MOBILE' },
    });
    ctx.hooks.declareHook('office.user.checked_out', {
      description: 'Un usuario salió de la oficina virtual',
      payload: { userId: 'string' },
    });
    ctx.hooks.declareHook('office.user.status_changed', {
      description: 'Un usuario cambió su estado (disponible, ocupado, etc.)',
      payload: {
        userId: 'string',
        status: 'AVAILABLE | IN_MEETING_INTERNAL | IN_MEETING_EXTERNAL | FOCUS | LUNCH | BRB',
      },
    });
    ctx.hooks.declareHook('office.user.moved', {
      description: 'Un usuario se movió a otra zona del layout',
      payload: { userId: 'string', zoneId: 'string', x: 'number', y: 'number' },
    });
    ctx.hooks.declareHook('office.absence.created', {
      description: 'Se registró una ausencia (permiso, vacaciones o incapacidad)',
      payload: { userId: 'string', type: 'PERMISO | VACACIONES | INCAPACIDAD', startAt: 'Date', endAt: 'Date' },
    });

    // ── Cron: auto-checkout por inactividad (>8h) ─────────────────────────────
    // Cierra tanto en VLA como en Bitrix ANTES de que la jornada expire (~24h)
    ctx.cron('*/5 * * * *', async () => {
      const threshold = new Date(Date.now() - 8 * 60 * 60 * 1000);
      const absent = await absentUserIds(new Date());
      const stale = await ctx.prisma.presenceStatus.findMany({
        where: { isCheckedIn: true, lastActivityAt: { lt: threshold } },
      });
      for (const p of stale) {
        const userId = (p as any).userId;
        // No tiene sentido cerrar por inactividad a quien está de
        // incapacidad/vacaciones/permiso o de feriado hoy.
        if (absent.has(userId)) {
          ctx.logger.log(`Auto checkout omitido por ausencia: ${userId}`);
          continue;
        }
        await presence.checkOut(userId, 'WEB');
        // Also close in Bitrix to prevent EXPIRED state
        const bid = await bitrix.getBitrixIdForVlaUser(userId);
        if (bid) {
          const ok = await bitrix.timemanClose(bid);
          ctx.logger.warn(`Auto checkout por inactividad: ${userId} (bitrix ${bid} close=${ok})`);
        } else {
          ctx.logger.warn(`Auto checkout por inactividad: ${userId} (sin mapping Bitrix)`);
        }
      }
    });

    // ── Cron: sincronizar fotos + organigrama de Bitrix cada 6 horas ──────────
    // Cada sync va en su propio try/catch: syncOrgStructure() ya no lanza en
    // ningún caso, pero syncPhotos() sí puede (mismo problema de red) — que
    // falle una no debe impedir que corra la otra en el mismo tick.
    ctx.cron('0 */6 * * *', async () => {
      try { await bitrix.syncPhotos(); } catch (e) { ctx.logger.warn(`Cron syncPhotos: ${e}`); }
      try { await bitrix.syncOrgStructure(); } catch (e) { ctx.logger.warn(`Cron syncOrgStructure: ${e}`); }
    });

    // ── Helper: mensajes de error de invitaciones ─────────────────────────────
    function reasonMessage(reason: string): string {
      switch (reason) {
        case 'not_found':   return 'Invitación no encontrada';
        case 'not_yours':   return 'Esa invitación no es tuya';
        case 'expired':     return 'La invitación venció';
        case 'not_pending': return 'Esa invitación ya fue respondida';
        default:            return 'No se pudo procesar la invitación';
      }
    }

    // ── Helper: usuarios a los que el cron no debe tocar ──────────────────────
    /**
     * Usuarios a los que el cron no debe tocar: tienen ausencia activa o
     * feriado efectivo hoy. Un solo par de queries, no uno por usuario.
     */
    async function absentUserIds(now: Date): Promise<Set<string>> {
      const users = await ctx.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      const ids = (users as any[]).map(u => u.id);

      const [active, countryOf] = await Promise.all([
        absences.activeByUserId(now),
        org.countryByUserId(ids),
      ]);
      const onHoliday = await holidays.effectiveByUserId(now, countryOf, tz());

      // .keys() en los dos: `active` es Map<userId, AbsenceWindow> y `onHoliday`
      // es Map<userId, justificacion|null>. Esparcir un Map da pares
      // [clave, valor], no claves, y el Set quedaria lleno de arreglos: el
      // `absent.has(userId)` de abajo daria siempre false y el blindaje no
      // blindaria nada, en silencio.
      return new Set([...active.keys(), ...onHoliday.keys()]);
    }

    // ── Helper: sync timeman → presence ───────────────────────────────────────
    async function runTimemanSync(): Promise<{ synced: number; errors: number; skipped: number; skippedByAbsence: number }> {
      const now = new Date();
      const absent = await absentUserIds(now);

      let synced = 0, errors = 0, skipped = 0, skippedByAbsence = 0;

      // syncTimemanStatuses() no atrapa sus propios fallos de red (a diferencia
      // de syncOrgStructure(), que sí lo hace) — un Bitrix inalcanzable lanza
      // TypeError: fetch failed y, sin este try/catch, tumba el proceso entero
      // cuando el llamador es un endpoint HTTP (Express 4 no atrapa rechazos
      // de promesas en handlers async; el cron sí tiene su propio wrapper).
      // Verificado en vivo: POST /timeman/sync contra el stub de Bitrix
      // (dominio nonexistent.invalid) mató el servidor antes de este guard.
      let statuses: Array<{ userId: string; isOpen: boolean }>;
      try {
        statuses = await bitrix.syncTimemanStatuses();
      } catch (e) {
        ctx.logger.warn(`Timeman sync: Bitrix inalcanzable, nada que procesar: ${e}`);
        return { synced, errors, skipped, skippedByAbsence };
      }

      for (const { userId, isOpen } of statuses) {
        try {
          // Una ausencia o un feriado gana sobre lo que diga timeman.
          if (absent.has(userId)) { skippedByAbsence++; continue; }

          // Respect manual override — user manually checked in/out from the plugin
          if (await presence.hasManualOverride(userId)) {
            skipped++;
            continue;
          }
          const current = await ctx.prisma.presenceStatus.findFirst({ where: { userId } }) as any;
          if (isOpen && !current?.isCheckedIn) {
            await presence.checkIn(userId, 'BITRIX');
            synced++;
          } else if (!isOpen && current?.isCheckedIn) {
            await presence.checkOut(userId, 'BITRIX');
            synced++;
          }
        } catch (e) {
          ctx.logger.warn(`timeman sync error for ${userId}: ${e}`);
          errors++;
        }
      }

      if (synced > 0 || skipped > 0 || skippedByAbsence > 0) {
        ctx.logger.log(
          `Timeman sync: ${synced} actualizados, ${skipped} omitidos (manual override), ` +
          `${skippedByAbsence} omitidos (ausencia o feriado)`,
        );
      }
      return { synced, errors, skipped, skippedByAbsence };
    }

    // Sincronización manual de timeman, disponible para quien administra la
    // oficina (no solo ADMIN) — es la que usa la verificación del blindaje.
    ctx.router.post('/timeman/sync', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), async (_req, res) => {
      res.json(await runTimemanSync());
    });

    // ── Cron: sincronizar timeman de Bitrix cada 2 minutos ────────────────────
    ctx.cron('*/2 * * * *', async () => {
      await runTimemanSync();
    });
  },

  async onDeactivate() {
    // cron jobs y SSE clients se limpian automáticamente por el core
  },
};

export default plugin;
