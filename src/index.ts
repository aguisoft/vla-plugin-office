import type { Request, Response } from 'express';
import type { PluginDefinition } from '@vla/plugin-sdk';
import { compararVentana } from './lib/absence-window';
import { PresenceService } from './services/presence.service';
import { LayoutService } from './services/layout.service';
import { SnapshotService } from './services/snapshot.service';
import { BitrixService } from './services/bitrix.service';
import { AbsenceService } from './services/absence.service';
import { OrgService } from './services/org.service';
import { HolidayService } from './services/holiday.service';
import { MeetingService } from './services/meeting.service';
import { TimesheetService } from './services/timesheet.service';
import { TeamService } from './services/team.service';
import { ComplianceService } from './services/compliance.service';
import { BitrixUserService } from './services/bitrix-user.service';
import { MensajeriaService, SinBitrixError } from './services/mensajeria.service';
import { dialogoValido, textoMensaje } from './lib/im-aviso';
import { RESTRICTED_ABSENCES } from './lib/absence-validation';
import { DEFAULT_TZ, localDateString } from './lib/local-date';
import { cumplimientoToCsv } from './lib/compliance-csv';
import { validateStatusInput, type StatusInput, type OfficeStatus } from './lib/status-rules';
import { periodBounds, resolveScope, canSee, reconcile, type Period } from './lib/timesheet';

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
      // "Administrar layouts" era cierto en la v1.0.0, cuando este permiso solo
      // movía escritorios. Hoy abre feriados, organigrama (país y jefe de cada
      // persona), las ausencias de todos y las sincronizaciones con Bitrix. Quien
      // reparte permisos en el panel lee la etiqueta, no el código: una que se
      // quedó corta hace que se conceda de más sin querer.
      [PERMS.MANAGE]:  { label: 'Administrar oficina (feriados, organigrama, ausencias)', group: 'Oficina Virtual', plugin: ctx.plugin.name },
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
      {
        // Sin este preset, el único camino a la pantalla de feriados es ser
        // ADMIN: `office.manage` no venía en ningún rol sugerido, así que
        // dárselo a RRHH obligaba a armar un rol a mano sabiendo de antemano
        // qué permiso pedir. Lleva VIEW y CHECKIN además de MANAGE porque el
        // rol es el conjunto completo de permisos de la persona: quien lo tenga
        // también necesita usar la oficina como cualquier colaborador.
        name: 'RRHH Oficina',
        description: 'Carga feriados, ausencias y el organigrama (país y jefe de cada persona)',
        permissions: [PERMS.VIEW, PERMS.CHECKIN, PERMS.MANAGE],
        color: '#8b5cf6',
        plugin: ctx.plugin.name,
      },
    ]);

    const presence = new PresenceService(ctx);
    const layout   = new LayoutService(ctx);
    const absences = new AbsenceService(ctx);
    const tz = () => (ctx.plugin.config.TIMEZONE as string) || DEFAULT_TZ;
    // org va ANTES que bitrix: el sync del organigrama le pasa el catálogo de
    // departamentos para que los nombres queden guardados. OrgService no depende
    // de BitrixService, así que el orden se puede invertir sin ciclo.
    const org = new OrgService(
      ctx,
      () => (ctx.plugin.config.DEFAULT_COUNTRY as string) || 'CR',
      // Zonas del layout activo, para sugerir dónde se sienta cada persona.
      // Degrada a lista vacía: sin layout no hay sugerencia, pero el país, el
      // departamento y el jefe se siguen resolviendo igual.
      async () => {
        try {
          const activo = await layout.getActive();
          return (activo?.zones ?? []).map(z => ({ id: z.id, name: z.name }));
        } catch (e) {
          ctx.logger.warn(`No se pudieron leer las zonas del layout: ${e}`);
          return [];
        }
      },
    );
    const bitrix   = new BitrixService(ctx, deps => org.upsertDepartments(deps));
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
    // Las dos últimas son funciones y no valores porque `ctx.plugin.config` se
    // hidrata después de registrar el plugin: leerlas acá congelaría el default.
    const timesheet = new TimesheetService(
      ctx,
      tz,
      absences,
      horasConfig('WORKDAY_HOURS', 8),
      horasConfig('MAX_OPEN_SESSION_HOURS', 12),
    );
    // Misma razón que timesheet arriba: MAX_OPEN_SESSION_HOURS se lee perezoso
    // porque ctx.plugin.config se hidrata después de registrar el plugin.
    // `org`/`holidays` (I5): descuenta del denominador de "N de M días" los
    // feriados del país de cada persona, ya instanciados arriba.
    const team = new TeamService(ctx, tz, horasConfig('MAX_OPEN_SESSION_HOURS', 12), org, holidays);
    // Task 9: reporte de cumplimiento de TODA la organización. Reusa team
    // (excepciones), org (organigrama) y timesheet (coverageStart) en vez de
    // repetir sus consultas -- ver compliance.service.ts para el detalle de
    // qué se reusó y qué se decidió escribir aparte.
    const compliance = new ComplianceService(ctx, tz, team, org, holidays, timesheet);
    // Mensajería de Bitrix como cada persona (widget de escritorio).
    const bitrixUser = new BitrixUserService(ctx);
    const mensajeria = new MensajeriaService(ctx, bitrixUser, presence);

    // ── Helper: configuración en horas ────────────────────────────────────────
    /**
     * Lector perezoso de una configuración expresada en horas, acotada a
     * [1, 24]; fuera de ese rango vale el respaldo.
     *
     * No hay quién valide el rango antes: `validateConfig` del core solo mira el
     * TIPO, y solo si el plugin declara un esquema de `settings`. Desde 1.10.0
     * ese esquema EXISTE (`plugin.json` → `settings.sections` → «Jornada»,
     * con `min: 1` y `max: 24`), así que el panel ya no deja escribir un
     * número fuera de rango.
     *
     * Esta validación se queda igual y no es redundante: el esquema cubre lo
     * que se escribe DESDE EL PANEL, y no lo que ya está guardado de antes ni
     * lo que entre por `PATCH /plugins/office/config` directo. Es la defensa
     * en la lectura, que es la única que corre siempre.
     *
     * Y un valor absurdo no se nota: con `MAX_OPEN_SESSION_HOURS: -5`,
     * `capOpenSession` devuelve un fin anterior al inicio, `clipSpan` descarta
     * el tramo y toda sesión abierta aporta 0 minutos mientras la nota al pie
     * asegura que «se acotó a −5 horas». El cálculo roto en silencio y la
     * explicación mintiendo.
     *
     * El aviso sale una sola vez: el getter corre en cada petición y un warning
     * por request es ruido que nadie termina de leer.
     */
    function horasConfig(clave: 'WORKDAY_HOURS' | 'MAX_OPEN_SESSION_HOURS', respaldo: number): () => number {
      let avisado = false;
      return () => {
        const crudo = ctx.plugin.config[clave];
        if (typeof crudo === 'number' && Number.isFinite(crudo) && crudo >= 1 && crudo <= 24) {
          return crudo;
        }
        // Sin configurar no hay nada que avisar: el respaldo es el caso normal,
        // no un descarte. Solo se avisa cuando había un valor y se ignoró.
        if (crudo !== undefined && crudo !== null && crudo !== '' && !avisado) {
          avisado = true;
          // `JSON.stringify` colapsa NaN e Infinity en «null» y perdería justo
          // el valor que hay que ver; se reserva para strings y objetos, donde
          // las comillas son lo que distingue "10" de 10.
          const recibido = typeof crudo === 'string' || typeof crudo === 'object'
            ? JSON.stringify(crudo)
            : String(crudo);
          ctx.logger.warn(
            `${clave} fuera de rango (recibido: ${recibido}); se usa el respaldo de ${respaldo} horas. Válido: un número entre 1 y 24.`,
          );
        }
        return respaldo;
      };
    }

    // ── Helper: rutas async que no tumban el proceso ──────────────────────────
    /**
     * Envuelve un handler async para que un rechazo termine en un 500 y no en
     * un API muerto.
     *
     * Express 4 no reenvía los rechazos de promesas al middleware de error: el
     * que el core registra por plugin nunca los ve. Y como el API no tiene
     * `process.on('unhandledRejection')`, un `await` que rechaza —Postgres
     * caído, pool agotado, tabla ausente— no rompe la petición: rompe el
     * proceso entero, y con él la oficina de todos. Es el mismo modo de falla
     * que ya obligó al try/catch de `runTimemanSync` más abajo en este archivo,
     * ahí verificado en vivo (un POST a /timeman/sync mató el servidor).
     *
     * Desde 1.7.1 toda ruta asíncrona del plugin va envuelta: la auditoría que
     * balancea paréntesis sobre este archivo no encuentra ninguna suelta. Si
     * agregás una ruta `async`, envolvela — Express 4 no la va a atrapar.
     */
    function asyncRoute(handler: (req: Request, res: Response) => Promise<unknown>) {
      return async (req: Request, res: Response): Promise<void> => {
        try {
          await handler(req, res);
        } catch (e) {
          ctx.logger.error(`${req.method} ${req.originalUrl}: ${e}`);
          // El handler puede haber respondido antes de fallar (un 403 y después
          // un await que revienta): un segundo envío lanzaría
          // ERR_HTTP_HEADERS_SENT y dejaría el rechazo suelto otra vez.
          if (!res.headersSent) {
            res.status(500).json({ message: 'No se pudo cargar la información. Intentá de nuevo en un momento.' });
          }
        }
      };
    }

    // ── Helper: period/anchor de las rutas de tiempos ─────────────────────────
    /**
     * `period`/`anchor` los parsean hoy /timesheet/office y /timesheet/team,
     * cada uno con su propia copia del mismo bloque. Task 9/10 agrega un
     * tercer y cuarto lugar (`/timesheet/compliance` y `/timesheet/export`)
     * que necesitan EXACTAMENTE la misma validación -- el CSV tiene que
     * poder pedir el mismo período que la pantalla está mostrando -- así
     * que la tercera copia se evita acá. Las dos rutas viejas quedan como
     * estaban (no se tocan en esta tarea).
     */
    function parsePeriodAnchor(req: Request): { period: Period; anchor: Date } | { error: string } {
      const period = (req.query.period as Period) || 'week';
      if (!['day', 'week', 'month'].includes(period)) {
        return { error: 'period debe ser day, week o month' };
      }
      const anchorRaw = req.query.anchor as string | undefined;
      // Mediodía UTC a propósito: el mismo YYYY-MM-DD cae en el mismo día
      // local en UTC-6 sin depender de a qué hora corre el servidor.
      const anchor = anchorRaw ? new Date(`${anchorRaw}T12:00:00Z`) : new Date();
      if (Number.isNaN(anchor.getTime())) {
        return { error: 'anchor inválido, se espera YYYY-MM-DD' };
      }
      return { period, anchor };
    }

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

    ctx.router.get('/presence', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (_req, res) => {
      res.json(await presence.getAll());
    }));

    ctx.router.get('/presence/all', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (_req, res) => {
      res.json(await presence.getAllIncludingOffline());
    }));

    ctx.router.get('/presence/:userId', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
      const record = await presence.getOne(req.params.userId);
      if (!record) return res.status(404).json({ message: 'Usuario no encontrado' });
      res.json(record);
    }));

    ctx.router.patch('/presence/status', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), asyncRoute(async (req, res) => {
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
    }));

    // ── Check-in / Check-out manual ────────────────────────────────────────────

    ctx.router.post('/checkin', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), asyncRoute(async (req, res) => {
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
    }));

    ctx.router.post('/checkout', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), asyncRoute(async (req, res) => {
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
    }));

    // ── Ausencias (permiso, vacaciones, incapacidad) ───────────────────────────
    // El body.startAt/endAt cambia de forma según el type (AbsenceInput en
    // absence-validation.ts): PERMISO manda instante real; VACACIONES/
    // INCAPACIDAD mandan fecha PURA "YYYY-MM-DD" que el servidor ancla a la
    // zona de la operación (ver absence-bounds.ts). No es simetría por
    // gusto: es la corrección de la regresión donde el navegador convertía
    // esas dos fechas a instante con SU zona antes de mandarlas.

    ctx.router.post('/absences', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), asyncRoute(async (req, res) => {
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
    }));

    // Ausencias de uno mismo (por defecto) o de ?userId= si quien pregunta es
    // su jefe directo o tiene office.manage. La justificación de PERMISO e
    // INCAPACIDAD (datos médicos/personales) se omite del payload si no
    // corresponde verla — nunca viaja vacía, el campo directamente no está.
    ctx.router.get('/absences', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
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
    }));

    ctx.router.delete('/absences/:id', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), asyncRoute(async (req, res) => {
      const requesterId = (req as any).user?.sub;
      if (!requesterId) return res.status(401).json({ message: 'Unauthorized' });
      const canManage = can(req, PERMS.MANAGE);
      const done = await absences.remove(req.params.id, requesterId, canManage);
      if (!done) return res.status(404).json({ message: 'Ausencia no encontrada' });
      res.status(204).end();
    }));

    // ── Feriados (calendario por país + override personal) ────────────────────

    ctx.router.get('/holidays', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
      const year = req.query.year ? Number(req.query.year) : undefined;
      res.json(await holidays.list(year, req.query.country as string | undefined));
    }));

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

    ctx.router.delete('/holidays/:id', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), asyncRoute(async (req, res) => {
      const done = await holidays.remove(req.params.id);
      if (!done) return res.status(404).json({ message: 'Feriado no encontrado' });
      res.status(204).end();
    }));

    // Feriados que el colaborador todavía puede mover
    ctx.router.get('/holidays/movable', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const country = await org.countryOf(userId);
      res.json(await holidays.movableForUser(userId, country));
    }));

    // ── Solicitudes de feriado movido ─────────────────────────────────────
    // Van ANTES de /holidays/:id/override: aunque hoy no colisionan (distinto
    // número de segmentos), el orden literal-antes-que-paramétrico es la
    // convención del archivo y lo que evita que la próxima ruta lo rompa.

    /** Las solicitudes propias, con su estado y la respuesta del jefe. */
    ctx.router.get('/holidays/overrides/mine', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      res.json(await holidays.solicitudesDe(userId));
    }));

    /** La bandeja del jefe: lo que su gente pidió y él no ha respondido. */
    ctx.router.get('/holidays/overrides/pending', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const aCargo = await org.managedUserIds(userId);
      res.json(await holidays.pendientesDe([...aCargo]));
    }));

    for (const accion of ['approve', 'reject'] as const) {
      ctx.router.post(`/holidays/overrides/:id/${accion}`, ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), asyncRoute(async (req, res) => {
        const userId = (req as any).user?.sub;
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });
        const { note } = req.body as { note?: string };

        const result = await holidays.decidir(
          req.params.id, userId, accion, note ?? '',
          solicitanteId => org.isManagerOf(userId, solicitanteId),
        );
        if (result.ok) return res.json({ ok: true });

        if ('errors' in result) {
          return res.status(400).json({ message: 'Datos inválidos', errors: result.errors });
        }
        // Mismos códigos que las invitaciones a reunión, para que el plugin
        // hable un solo idioma de errores.
        const code = result.reason === 'not_found' ? 404
                   : result.reason === 'not_yours' ? 403 : 409;
        const mensaje = result.reason === 'not_found' ? 'Esa solicitud no existe'
                      : result.reason === 'not_yours' ? 'Solo el jefe directo de quien la pidió puede responderla'
                      : 'Esa solicitud ya fue respondida';
        res.status(code).json({ message: mensaje });
      }));
    }

    ctx.router.post('/holidays/:id/override', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), asyncRoute(async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const { newDate, justification } = req.body as { newDate: string; justification: string };
      // country es el país RESUELTO HOY del colaborador (org.countryOf), no un
      // dato que venga del body: es la defensa en la escritura contra mover un
      // feriado que no le corresponde (ver holiday.service.ts).
      const country = await org.countryOf(userId);
      // Sin jefe directo no hay quién apruebe; el servicio la registra ya
      // aprobada pero sin revisor, y `status` en la respuesta le dice a la
      // pantalla cuál de los dos casos mostrar.
      const tieneJefe = (await org.managerOf(userId)) !== null;
      const result = await holidays.setOverride(
        userId, req.params.id, new Date(newDate), justification ?? '', country, tz(), tieneJefe,
      );
      if (!result.ok) return res.status(400).json({ message: 'Datos inválidos', errors: result.errors });
      res.status(201).json({ ok: true, status: result.status });
    }));

    ctx.router.delete('/holidays/:id/override', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), asyncRoute(async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const done = await holidays.clearOverride(userId, req.params.id);
      if (!done) return res.status(404).json({ message: 'No hay override para ese feriado' });
      res.status(204).end();
    }));

    // ── Invitaciones a reunión ──────────────────────────────────────────────
    // El anfitrión entra a la reunión de inmediato desde PATCH /presence/status
    // (Task 16, que llama meetings.invite); acá solo vive el lado del invitado:
    // ver sus invitaciones pendientes y responder. cancel es del anfitrión, no
    // se expone como endpoint del invitado — ver meeting-invites.ts.

    ctx.router.get('/meetings/invites', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      res.json(await meetings.pendingFor(userId));
    }));

    for (const action of ['accept', 'decline'] as const) {
      ctx.router.post(`/meetings/invites/:id/${action}`, ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), asyncRoute(async (req, res) => {
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
      }));
    }

    // NO hay endpoint /leave. La salida voluntaria del invitado es simplemente
    // cambiar de estado con el selector, y el PATCH /presence/status de la
    // Task 16 se encarga de cerrar su fila de MeetingInvite. Un endpoint aparte
    // sería salteable y exigiría una UI que el spec no pide.

    // ── Snapshot (users + presence + avatars + bitrix photos) ─────────────────

    ctx.router.get('/snapshot', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
      const snap = await snapshot.getAll({
        userId: (req as any).user.sub,
        hasManage: can(req, PERMS.MANAGE),
      });
      res.json(snap);
    }));

    // ── Photo proxy (avoids browser CDN/CORS issues with Bitrix URLs) ──────────
    ctx.router.get('/photo/:userId', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
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
    }));

    ctx.router.patch('/me/avatar', ctx.requireAuth(), asyncRoute(async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      await snapshot.updateAvatar(userId, req.body);
      res.json({ ok: true });
    }));

    // ── Bitrix24 ──────────────────────────────────────────────────────────────

    // Webhook entrante (check-in/out desde Bitrix)
    ctx.router.post('/bitrix/webhook', asyncRoute(async (req, res) => {
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
    }));

    // Debug: timeman status por usuario (admin)
    ctx.router.get('/bitrix/debug-timeman', ctx.requireAuth('ADMIN'), asyncRoute(async (_req, res) => {
      res.json(await bitrix.debugTimeman());
    }));

    // Sincronización manual de fotos (admin)
    ctx.router.post('/bitrix/sync', ctx.requireAuth('ADMIN'), asyncRoute(async (_req, res) => {
      const result = await bitrix.syncPhotos();
      res.json({ ok: true, ...result });
    }));

    // Sincronización manual de timeman (admin)
    ctx.router.post('/bitrix/sync-timeman', ctx.requireAuth('ADMIN'), asyncRoute(async (_req, res) => {
      const result = await runTimemanSync();
      res.json({ ok: true, ...result });
    }));

    // ── Organigrama (jefe directo, país) ───────────────────────────────────────

    // Diagnóstico de SOLO LECTURA: mide si vale la pena inferir el país del
    // teléfono cuando PERSONAL_COUNTRY viene vacío. No escribe nada y no expone
    // ni un número: solo formas, prefijos y conteos.
    //
    // Es GET a propósito, para que no pueda confundirse con una acción. Y va
    // con office.manage porque agrega datos de toda la organización.
    //
    // VA ANTES de '/org/:userId': Express resuelve por orden de registro, así
    // que la ruta paramétrica se traga cualquier literal declarado después y
    // devuelve el override de un usuario llamado "country-coverage".
    ctx.router.get('/org/country-coverage', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), asyncRoute(async (_req, res) => {
      res.json(await bitrix.countryCoverageReport());
    }));

    /**
     * Roster completo para la pantalla de feriados: cada colaborador con su
     * país resuelto, DE DÓNDE sale ese país, y su jefe directo.
     *
     * El `countrySource` es la razón de existir de este endpoint. Hoy los 35
     * mapeos tienen `country = null`, así que todos caen al default: sin el
     * origen, RRHH ve 35 personas en "CR" y asume que el dato está cargado.
     * Con el origen ve "35 × por defecto" y entiende que tiene que marcar las
     * excepciones.
     *
     * Va con office.manage y ANTES de '/org/:userId' — Express resuelve por
     * orden de registro y la paramétrica se tragaría el literal.
     */
    /**
     * Catálogo de departamentos para el desplegable y el filtro de la pantalla.
     *
     * VA ANTES de '/org/:userId' por el orden de registro de Express: la
     * paramétrica se tragaría este literal y devolvería el perfil de un usuario
     * llamado "departments".
     */
    ctx.router.get('/org/departments', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), asyncRoute(async (_req, res) => {
      res.json({ departments: await org.departments() });
    }));

    ctx.router.get('/org/roster', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), asyncRoute(async (_req, res) => {
      const users = await ctx.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, firstName: true, lastName: true, email: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      });
      const ids = (users as any[]).map(u => u.id);
      const roster = await org.roster(ids);

      const zonasDelMapa = (await layout.getActive())?.zones ?? [];

      res.json({
        defaultCountry: (ctx.plugin.config.DEFAULT_COUNTRY as string) || 'CR',
        zones: zonasDelMapa.map(z => ({ id: z.id, name: z.name })),
        users: (users as any[]).map(u => {
          const r = roster.get(u.id);
          return {
            userId: u.id,
            firstName: u.firstName,
            lastName: u.lastName,
            email: u.email,
            country: r?.country ?? null,
            countrySource: r?.countrySource ?? 'default',
            managerUserId: r?.managerUserId ?? null,
            managerSource: r?.managerSource ?? 'none',
            departmentId: r?.departmentId ?? null,
            departmentName: r?.departmentName ?? null,
            departmentSource: r?.departmentSource ?? 'none',
            zoneId: r?.zoneId ?? null,
            zoneName: r?.zoneName ?? null,
            zoneSource: r?.zoneSource ?? 'none',
          };
        }),
      });
    }));

    /**
     * El organigrama, visible para CUALQUIER colaborador.
     *
     * Endpoint aparte de `/org/roster` —que exige `office.manage`— a
     * propósito, y no por comodidad: el roster lleva el correo de cada
     * persona y el ORIGEN de cada dato (`override` / `bitrix` / `default`),
     * que son metadatos de administración. Acá va lo mínimo para dibujar la
     * jerarquía. Reusar el roster habría significado o exponer todo eso a
     * todos, o esconderle el organigrama a quien trabaja en él.
     *
     * Va ANTES de `/org/:userId`: la paramétrica se tragaría `/org/chart`.
     */
    ctx.router.get('/org/chart', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (_req, res) => {
      const users = await ctx.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      });
      const ids = (users as any[]).map(u => u.id);

      // El estado sale de `SnapshotService` y no de `PresenceStatus` crudo: ahí
      // vive la resolución real (un feriado del país gana sobre el estado del
      // día, una ausencia vigente gana sobre todo). Duplicar esa lógica acá
      // daría dos verdades sobre la misma persona.
      //
      // `hasManage: false` a propósito: ese parámetro decide si el snapshot
      // adjunta las justificaciones AJENAS, y el organigrama lo ve cualquiera.
      // Acá solo se usa el estado, nunca su motivo.
      const [roster, presencia] = await Promise.all([
        org.roster(ids),
        snapshot.getAll({ userId: (_req as any).user?.sub ?? '', hasManage: false })
          .catch(e => {
            // Degrada: sin estados el organigrama sigue sirviendo para lo que
            // es —quién depende de quién—, que es su razón de ser.
            ctx.logger.warn(`/org/chart: no se pudieron leer los estados: ${e}`);
            return [] as Array<{ userId: string; status: string }>;
          }),
      ]);
      const estadoDe = new Map((presencia as any[]).map(p => [p.userId, p.status as string]));
      const paisDe = await org.countryByUserId(ids);

      res.json({
        personas: (users as any[]).map(u => {
          const r = roster.get(u.id);
          const nombre = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
          return {
            userId: u.id,
            // `null` y no cadena vacía: una tarjeta en blanco en el
            // organigrama no dice de quién habla, y la pantalla necesita
            // poder decir «nombre no disponible» en vez de dibujar un hueco.
            nombre: nombre || null,
            managerUserId: r?.managerUserId ?? null,
            departamento: r?.departmentName ?? null,
            // `null` y no 'OFFLINE' cuando la consulta de estados falló: decir
            // que alguien está desconectado es una afirmación sobre esa
            // persona, y acá no se sabe. La pantalla lo muestra sin estado.
            estado: estadoDe.get(u.id) ?? null,
            pais: paisDe.get(u.id) ?? null,
          };
        }),
      });
    }));

    ctx.router.get('/org/:userId', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
      const { userId } = req.params;
      res.json({
        userId,
        managerUserId: await org.managerOf(userId),
        country: await org.countryOf(userId),
      });
    }));

    ctx.router.put('/org/:userId', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), asyncRoute(async (req, res) => {
      const { managerUserId, country, departmentId, zoneId } = req.body as {
        managerUserId?: string | null; country?: string | null;
        departmentId?: string | null; zoneId?: string | null;
      };
      const userId = req.params.userId;

      // Nadie puede ser su propio jefe
      if (managerUserId === userId) {
        return res.status(400).json({ message: 'Nadie puede ser su propio jefe' });
      }

      // Ciclo de dos personas: si el jefe propuesto ya tiene a este usuario
      // como su jefe, se formaría un ciclo A→B→A
      if (managerUserId) {
        const proposedManagersManager = await org.managerOf(managerUserId);
        if (proposedManagersManager === userId) {
          return res.status(400).json({
            message: 'Eso crearía un ciclo: el jefe propuesto ya tiene a esta persona como su jefe',
          });
        }
      }

      // El departamento se escribe aparte porque vive en el esquema del plugin,
      // no en UserProfileOverride. `undefined` es "no lo toques" y `null` es
      // "límpialo": sin esa distinción, guardar solo el país borraría el
      // departamento de quien ya lo tenía corregido.
      if (departmentId !== undefined) {
        // Mover a alguien de departamento puede darle un jefe nuevo —el del
        // departamento destino— y ese jefe podría ser alguien que ya depende de
        // él. Se valida contra el resultado, no contra la intención.
        if (departmentId !== null) {
          const head = (await org.departments()).some(d => d.id === departmentId);
          if (!head) {
            return res.status(400).json({ message: 'Ese departamento no existe en el catálogo' });
          }
        }
        await org.setDepartmentOverride(userId, departmentId);

        const nuevoJefe = await org.managerOf(userId);
        if (nuevoJefe && (await org.managerOf(nuevoJefe)) === userId) {
          // Revertir: el destino deja a los dos dependiendo uno del otro.
          await org.setDepartmentOverride(userId, null);
          return res.status(400).json({
            message: 'Eso crearía un ciclo: el jefe de ese departamento ya depende de esta persona',
          });
        }
      }

      // La zona del mapa vive en PresenceStatus, no en UserProfileOverride, así
      // que también se escribe aparte. Se valida contra el layout activo: una
      // zona inexistente deja el avatar sin dibujar y nadie lo relaciona con
      // este guardado.
      if (zoneId !== undefined) {
        if (zoneId !== null) {
          const zonas = (await layout.getActive())?.zones ?? [];
          if (!zonas.some(z => z.id === zoneId)) {
            return res.status(400).json({ message: 'Esa zona no existe en el mapa activo' });
          }
        }
        await org.setZone(userId, zoneId);
      }

      if (managerUserId !== undefined || country !== undefined) {
        await org.setOverride(userId, { managerUserId, country });
      }
      res.json({ ok: true });
    }));

    // Diagnóstico: cuántos usuarios traen país/jefe de Bitrix (admin funcional).
    // syncOrgStructure() nunca lanza — si Bitrix está inalcanzable devuelve
    // { synced: 0, heads: 0, withCountry: 0 } y queda logueado como warning.
    ctx.router.post('/org/sync', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), asyncRoute(async (_req, res) => {
      res.json(await bitrix.syncOrgStructure());
    }));

    // ── Layout ────────────────────────────────────────────────────────────────

    ctx.router.get('/layout', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (_req, res) => {
      const active = await layout.getActive();
      const positions = await layout.getUserPositions();
      res.json({ layout: active, positions });
    }));

    ctx.router.get('/layout/all', ctx.requireAuth('ADMIN'), asyncRoute(async (_req, res) => {
      res.json(await layout.getAll());
    }));

    ctx.router.post('/layout', ctx.requireAuth('ADMIN'), asyncRoute(async (req, res) => {
      const { name } = req.body as { name: string };
      if (!name) return res.status(400).json({ message: 'name is required' });
      res.status(201).json(await layout.create(name));
    }));

    ctx.router.post('/layout/:id/zones', ctx.requireAuth('ADMIN'), asyncRoute(async (req, res) => {
      const zone = await layout.addZone(req.params.id, req.body as any);
      res.status(201).json(zone);
    }));

    ctx.router.patch('/layout/position', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const { zoneId, x, y } = req.body as { zoneId: string; x: number; y: number };
      await layout.moveUser(userId, zoneId, x, y);
      res.json({ ok: true });
    }));

    // ── Dashboard de tiempos ────────────────────────────────────────────────────

    /**
     * Tiempo en oficina del período. El alcance lo resuelve el servidor: uno mismo
     * más los directos, o todo si es ADMIN.
     *
     * Pedir a alguien fuera del alcance devuelve 403 y no un resultado vacío: un
     * vacío se lee como "no hizo nada" e induce una conclusión falsa sobre una
     * persona.
     */
    ctx.router.get('/timesheet/office', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
      const viewerId = (req as any).user?.sub;
      if (!viewerId) return res.status(401).json({ message: 'Unauthorized' });

      const period = (req.query.period as Period) || 'week';
      if (!['day', 'week', 'month'].includes(period)) {
        return res.status(400).json({ message: 'period debe ser day, week o month' });
      }

      const anchorRaw = req.query.anchor as string | undefined;
      // Mediodía UTC a propósito: así el mismo YYYY-MM-DD cae en el mismo día
      // local en UTC-6, sin depender de a qué hora corre el servidor.
      const anchor = anchorRaw ? new Date(`${anchorRaw}T12:00:00Z`) : new Date();
      if (Number.isNaN(anchor.getTime())) {
        return res.status(400).json({ message: 'anchor inválido, se espera YYYY-MM-DD' });
      }

      const isAdmin = (req as any).user?.role === 'ADMIN';
      const scope = resolveScope(viewerId, await org.managedUserIds(viewerId), isAdmin);

      const target = (req.query.userId as string) || viewerId;
      if (!canSee(scope, target)) {
        return res.status(403).json({ message: 'No tenés acceso al tiempo de esa persona' });
      }

      const bounds = periodBounds(anchor, period, tz());
      // El fin efectivo nunca pasa del presente: un período que incluye hoy no debe
      // contar horas que todavía no ocurrieron (el servicio cierra la sesión abierta
      // contra este fin de span).
      const now = new Date();
      const span = { start: bounds.start, end: bounds.end < now ? bounds.end : now };

      const byUser = await timesheet.officeTime([target], span);
      // Trae el tiempo en oficina y el desglose por estado para construir el
      // gráfico del dashboard. El reconcile cierra cualquier brecha entre los
      // slices y el total — si la suma de estados < totalMinutes, el residuo
      // va a unaccountedMinutes (indica sesiones abiertas o sin classifier).
      const office = byUser.get(target)
        ?? { userId: target, totalMinutes: 0, byDay: [], openSessionCapped: false, openSessionCapHours: 0 };
      const crudo = await timesheet.statusBreakdown(target, span);

      // `null` es «no se pudo leer la tabla», distinto de `[]` («no hay
      // intervalos»). Con `[]` el reconcile mandaria todo el tiempo a
      // unaccountedMinutes y la pantalla dibujaria un grafico 100% «sin
      // registrar»: eso atribuye a «el plugin no esta registrando estados» lo
      // que en realidad es un fallo de infraestructura. Por eso el flag, y por
      // eso con `null` no se reconcilia nada.
      const { slices, unaccountedMinutes, overflowMinutes } = crudo === null
        ? { slices: [], unaccountedMinutes: 0, overflowMinutes: 0 }
        : reconcile(office.totalMinutes, crudo);

      res.json({
        period,
        from: bounds.start.toISOString(),
        to: bounds.end.toISOString(),
        office,
        breakdown: slices,
        unaccountedMinutes,
        // Lo que los tramos suman por encima del tiempo conectado antes del
        // reescalado. Sin esto, la rama que recorta se veia como
        // reconciliacion perfecta justo cuando las dos fuentes no cuadran.
        overflowMinutes,
        breakdownUnavailable: crudo === null,
        coverageStart: await timesheet.coverageStart(),
        // Ausencias del período (PERMISO/VACACIONES/INCAPACIDAD). Fuente
        // aparte de `breakdown`: no viven en PresenceStatus, así que no salen
        // del desglose por estado. Los feriados quedan fuera a propósito --
        // ver el comentario de tallyAbsences en lib/timesheet.ts.
        absences: await timesheet.absences(target, span),
      });
    }));

    /**
     * Tabla del equipo del período: una fila por persona del alcance.
     *
     * VA ANTES de cualquier ruta paramétrica de /timesheet por el orden de
     * registro de Express, igual que /timesheet/scope.
     *
     * El alcance es el mismo de siempre: uno mismo más los directos, o todo si
     * es ADMIN. No recibe `userId`: esta vista ES el equipo. Quien quiera una
     * sola persona usa /timesheet/office, que ya valida el 403.
     */
    ctx.router.get('/timesheet/team', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
      const viewerId = (req as any).user?.sub;
      if (!viewerId) return res.status(401).json({ message: 'Unauthorized' });

      const period = (req.query.period as Period) || 'week';
      if (!['day', 'week', 'month'].includes(period)) {
        return res.status(400).json({ message: 'period debe ser day, week o month' });
      }

      const anchorRaw = req.query.anchor as string | undefined;
      // Mediodía UTC a propósito: el mismo YYYY-MM-DD cae en el mismo día
      // local en UTC-6 sin depender de a qué hora corre el servidor.
      const anchor = anchorRaw ? new Date(`${anchorRaw}T12:00:00Z`) : new Date();
      if (Number.isNaN(anchor.getTime())) {
        return res.status(400).json({ message: 'anchor inválido, se espera YYYY-MM-DD' });
      }

      const isAdmin = (req as any).user?.role === 'ADMIN';
      const scope = resolveScope(viewerId, await org.managedUserIds(viewerId), isAdmin);

      // I3/M4: mismo patrón que /timesheet/scope (línea de abajo, `where`),
      // en vez de `[...scope]` tal cual. `managedUserIds` no filtra
      // `isActive` -- sale de `BitrixUserMapping` ∪ `UserProfileOverride`,
      // que no se borran al desactivar a alguien -- así que la rama del jefe
      // colaba ex-empleados como filas "sin registrar" permanentes (I3) y,
      // sin ORDER BY, la tabla se reordenaba entre recargas según el orden
      // del `Set` (M4). Se filtra y se ordena ACÁ, no dentro de
      // `managedUserIds`: ese método también alimenta `/timesheet/office`
      // (un jefe pidiendo el detalle de un ex-subordinado puntual es
      // inofensivo) y `SnapshotService` (visibilidad de justificaciones), y
      // ninguno de los dos necesita este filtro.
      const where = scope === null
        ? { isActive: true }
        : { isActive: true, id: { in: [...scope] } };
      const ids = (await ctx.prisma.user.findMany({
        where,
        select: { id: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }) as any[]).map(u => u.id);

      const bounds = periodBounds(anchor, period, tz());
      const [{ filas, cobertura, periodoFuturo }, excepciones] = await Promise.all([
        team.filasYCobertura(ids, period, anchor),
        // Task 9 cambió `excepciones()` para que RECHACE si la consulta
        // falla (antes degradaba sola a `{ sinMarcar30Dias: [], sesionesAbiertas: [] }`,
        // que es el mismo "cero inventado" que el resto del plugin viene
        // corrigiendo). Acá se conserva el degrade de siempre -- esta
        // pantalla ya fue revisada con ese contrato -- y `ComplianceService`
        // (que sí necesita distinguir "sin excepciones" de "no se pudo
        // comprobar") lo refleja como `null` en su lugar.
        team.excepciones(ids).catch(e => {
          ctx.logger.warn(`/timesheet/team: no se pudieron leer las excepciones: ${e}`);
          return { sinMarcar30Dias: [], sesionesAbiertas: [] };
        }),
      ]);

      res.json({
        period,
        from: bounds.start.toISOString(),
        to: bounds.end.toISOString(),
        viewerId,
        isAdmin,
        filas,
        excepciones,
        cobertura,
        // N4: el período todavía no ocurrió. Va como bandera y no como lista
        // vacía a secas, para que la pantalla diga «aún no ocurrió» en vez de
        // «nadie marcó entrada» — que sería una afirmación sobre 22 personas.
        periodoFuturo,
      });
    }));

    /**
     * Reporte de cumplimiento de TODA la organización (Task 9). Va con
     * `office.manage` y no con VIEW, a diferencia de /timesheet/team: acá no
     * hay alcance de "mis directos", `office.manage` YA es el permiso que da
     * acceso a los datos de todos.
     *
     * `period`/`anchor` solo alimentan `ausenciasDelPeriodo` -- el resto del
     * reporte mira el estado actual, no un recorte de tiempo -- pero viajan
     * igual para que `/timesheet/export` pueda pedir EXACTAMENTE lo que esta
     * ruta ya mostró.
     */
    ctx.router.get('/timesheet/compliance', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), asyncRoute(async (req, res) => {
      const parsed = parsePeriodAnchor(req);
      if ('error' in parsed) return res.status(400).json({ message: parsed.error });
      res.json(await compliance.cumplimiento(parsed.period, parsed.anchor));
    }));

    /**
     * CSV del mismo reporte de cumplimiento, con BOM UTF-8 (Requisito 3,
     * Task 10): sin él, Excel abre el archivo asumiendo Latin-1 y cualquier
     * tilde o ñ en un nombre sale rota. Mismo permiso que /timesheet/compliance
     * -- es el mismo dato, solo que serializado para descargar.
     *
     * I7: el spec pide "CSV de la tabla del equipo MÁS las banderas de
     * cumplimiento" -- lo que había solo volcaba lo segundo. `filas` sale de
     * TODOS los activos de la organización (mismo universo que
     * `ComplianceService.cumplimiento`, no el alcance de "mis directos" de
     * `/timesheet/team`): esta ruta ya exige `office.manage`, que es
     * justamente el permiso de ver a todo el mundo. Ordenados por nombre,
     * igual que /timesheet/scope y /timesheet/team (M4). `team.filas` nunca
     * rechaza -- degrada internamente a filas `no-disponible` -- así que no
     * hace falta un `.catch` acá.
     */
    ctx.router.get('/timesheet/export', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), asyncRoute(async (req, res) => {
      const parsed = parsePeriodAnchor(req);
      if ('error' in parsed) return res.status(400).json({ message: parsed.error });

      const activeIds = (await ctx.prisma.user.findMany({
        where: { isActive: true },
        select: { id: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }) as any[]).map(u => u.id);

      const [data, filas] = await Promise.all([
        compliance.cumplimiento(parsed.period, parsed.anchor),
        team.filas(activeIds, parsed.period, parsed.anchor),
      ]);
      const csv = cumplimientoToCsv(data, filas);
      const anchorRaw = (req.query.anchor as string | undefined) ?? localDateString(new Date(), tz());

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="cumplimiento-${anchorRaw}.csv"`);
      res.send(csv);
    }));

    /** A quién puede consultar el viewer. Alimenta el selector de persona. */
    ctx.router.get('/timesheet/scope', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
      const viewerId = (req as any).user?.sub;
      if (!viewerId) return res.status(401).json({ message: 'Unauthorized' });

      const isAdmin = (req as any).user?.role === 'ADMIN';
      const scope = resolveScope(viewerId, await org.managedUserIds(viewerId), isAdmin);

      const where = scope === null ? { isActive: true } : { isActive: true, id: { in: [...scope] } };
      const users = await ctx.prisma.user.findMany({
        where,
        select: { id: true, firstName: true, lastName: true, email: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      });

      res.json({ viewerId, isAdmin, users });
    }));

    // ── Bitrix por persona ────────────────────────────────────────────────────
    // Bitrix ignora el redirect_uri y siempre vuelve al callback del core, que
    // canjea el código y nos entrega los tokens por core.bitrix.user_authorized.
    // Por eso acá no hay callback: solo el arranque y el estado.
    ctx.router.get('/bitrix/oauth/start', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
      if (!ctx.bitrix) {
        res.status(503).json({ message: 'Bitrix no está configurado en el sistema' });
        return;
      }
      const userId = (req as any).user?.sub;
      res.redirect(await ctx.bitrix.userAuthorizeUrl(userId, '/dashboard/office'));
    }));

    ctx.router.get('/bitrix/oauth/estado', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
      res.json(await bitrixUser.estado((req as any).user?.sub));
    }));

    ctx.router.delete('/bitrix/oauth', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), asyncRoute(async (req, res) => {
      await bitrixUser.desconectar((req as any).user?.sub);
      res.json({ ok: true });
    }));

    // ── Mensajería (proxy a Bitrix con el token de quien pregunta) ────────────
    /**
     * Sin Bitrix conectado responde 409 con el camino para conectarlo. Nunca una
     * lista vacía: el widget la leería como «no tenés mensajes».
     */
    function rutaIm(handler: (userId: string, req: Request) => Promise<unknown>) {
      return asyncRoute(async (req, res) => {
        try {
          res.json(await handler((req as any).user?.sub, req));
        } catch (e) {
          if (e instanceof SinBitrixError) {
            res.status(409).json({ message: e.message, conectar: '/api/v1/p/office/bitrix/oauth/start' });
            return;
          }
          if (e instanceof Error && e.message.startsWith('[im.')) {
            ctx.logger.warn(`Bitrix rechazó ${req.method} ${req.originalUrl}: ${e.message}`);
            res.status(502).json({ message: 'Bitrix no respondió como se esperaba. Intentá de nuevo en un momento.' });
            return;
          }
          throw e;
        }
      });
    }
    const conVista = [ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW)];

    ctx.router.get('/im/recent', ...conVista, rutaIm(userId => mensajeria.recientes(userId)));
    ctx.router.get('/im/counters', ...conVista, rutaIm(userId => mensajeria.contadores(userId)));

    ctx.router.get('/im/dialog/:dialogId', ...conVista, asyncRoute(async (req, res) => {
      if (!dialogoValido(req.params.dialogId)) {
        res.status(400).json({ message: 'Diálogo inválido' });
        return;
      }
      await rutaIm(userId => mensajeria.dialogo(userId, req.params.dialogId))(req, res);
    }));

    ctx.router.post('/im/message', ...conVista, asyncRoute(async (req, res) => {
      const dialogId = req.body?.dialogId ?? (req.body?.toBitrixUserId != null ? String(req.body.toBitrixUserId) : undefined);
      const texto = textoMensaje(req.body?.text);
      if (!dialogoValido(dialogId)) {
        res.status(400).json({ message: 'Falta a quién mandar el mensaje' });
        return;
      }
      if (!texto) {
        res.status(400).json({ message: 'El mensaje tiene que tener entre 1 y 2000 caracteres' });
        return;
      }
      await rutaIm(userId => mensajeria.enviar(userId, dialogId, texto))(req, res);
    }));

    ctx.router.post('/im/read', ...conVista, asyncRoute(async (req, res) => {
      const dialogId = req.body?.dialogId;
      if (!dialogoValido(dialogId)) {
        res.status(400).json({ message: 'Diálogo inválido' });
        return;
      }
      await rutaIm(userId => mensajeria.marcarLeido(userId, dialogId))(req, res);
    }));

    // ── Hooks ─────────────────────────────────────────────────────────────────

    ctx.hooks.registerAction('core.bitrix.user_authorized', async (payload: any) => {
      await bitrixUser.alAutorizar(payload);
    });

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
    ctx.hooks.declareHook('office.absence.window_changed', {
      description: 'Una ausencia o feriado entró en vigencia o terminó (por reloj, no por una acción)',
      payload: { entraron: 'string[]', salieron: 'string[]' },
    });
    ctx.hooks.declareHook('office.absence.created', {
      description: 'Se registró una ausencia (permiso, vacaciones o incapacidad)',
      payload: { userId: 'string', type: 'PERMISO | VACACIONES | INCAPACIDAD', startAt: 'Date', endAt: 'Date' },
    });

    /**
     * Cron: avisar cuando una ausencia o un feriado EMPIEZA o TERMINA.
     *
     * Todo lo demás que refresca las pantallas ocurre porque alguien hizo
     * algo. Las ausencias programadas no: entran en vigencia por reloj. A esa
     * hora no hay evento, y la pantalla se queda con el estado viejo hasta que
     * otra persona haga cualquier cosa y dispare una recarga de rebote.
     *
     * Pasó en producción: un permiso de 10:00 a 10:20 creado a las 09:57. El
     * evento de creación refrescó a las 09:57, cuando todavía decía
     * «Disponible» con razón, y a las 10:00 no se disparó nada. La colaboradora
     * reportó que «su estado no cambió». El dato estaba bien —el backend ya la
     * resolvía como PERMISO— pero nadie se lo había contado a su navegador.
     *
     * Corre cada minuto porque un permiso puede durar veinte: con el tick de
     * cinco minutos del cron de inactividad se perdería un cuarto de la
     * ventana. `absentUserIds` ya resuelve ausencias Y feriados, así que el
     * mismo tick cubre los dos.
     */
    let ausentesPrevios: Set<string> | null = null;
    ctx.cron('* * * * *', async () => {
      try {
        const ahora = await absentUserIds(new Date());

        const cambio = compararVentana(ausentesPrevios, ahora);
        ausentesPrevios = ahora;
        if (!cambio) return;

        const { entraron, salieron } = cambio;
        presence.anunciarCambioPorReloj([...entraron, ...salieron]);
        await ctx.hooks.doAction('office.absence.window_changed', { entraron, salieron });
        ctx.logger.log(
          `Ventana de ausencia: ${entraron.length} entraron, ${salieron.length} salieron`,
        );
      } catch (e) {
        // Que falle un tick no puede tumbar el cron ni el proceso: el siguiente
        // minuto vuelve a intentar, y mientras tanto la pantalla sigue
        // refrescándose de rebote como lo hacía antes de existir esto.
        ctx.logger.warn(`Cron ventana de ausencia: ${e}`);
      }
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
    ctx.router.post('/timeman/sync', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), asyncRoute(async (_req, res) => {
      res.json(await runTimemanSync());
    }));

    // ── Cron: sincronizar timeman de Bitrix cada 2 minutos ────────────────────
    ctx.cron('*/2 * * * *', async () => {
      await runTimemanSync();
    });

    // ── Cron: mensajes nuevos de Bitrix (respaldo del aviso inmediato) ────────
    // Minutos impares, para no coincidir con el sync de timeman de arriba.
    ctx.cron('1-59/2 * * * *', async () => {
      try {
        await mensajeria.consultarRespaldo();
      } catch (e) {
        ctx.logger.warn(`Consulta de mensajes de respaldo falló: ${e}`);
      }
    });
  },

  async onDeactivate() {
    // cron jobs y SSE clients se limpian automáticamente por el core
  },
};

export default plugin;
