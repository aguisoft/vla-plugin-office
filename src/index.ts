import type { PluginDefinition } from '@vla/plugin-sdk';
import { PresenceService } from './services/presence.service';
import { LayoutService } from './services/layout.service';

const plugin: PluginDefinition = {
  async register(ctx) {
    ctx.logger.log('Office plugin iniciado');

    const presence = new PresenceService(ctx);
    const layout = new LayoutService(ctx);

    // ── Real-time SSE ──────────────────────────────────────────────────────────
    // Clientes se conectan a GET /api/v1/p/office/events para recibir eventos
    // en tiempo real (Server-Sent Events — funciona con cualquier HTTP client).
    ctx.router.get('/events', ctx.requireAuth(), (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const unsubscribe = presence.subscribe((data) => res.write(data));
      req.on('close', unsubscribe);
    });

    // ── Presencia ──────────────────────────────────────────────────────────────

    ctx.router.get('/presence', ctx.requireAuth(), async (_req, res) => {
      res.json(await presence.getAll());
    });

    ctx.router.get('/presence/:userId', ctx.requireAuth(), async (req, res) => {
      const record = await presence.getOne(req.params.userId);
      if (!record) return res.status(404).json({ message: 'Usuario no encontrado' });
      res.json(record);
    });

    ctx.router.patch('/presence/status', ctx.requireAuth(), async (req, res) => {
      const { status, customStatus } = req.body as { status: string; customStatus?: string };
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      res.json(await presence.updateStatus(userId as any, status as any, customStatus));
    });

    // ── Check-in / Check-out manual ────────────────────────────────────────────

    ctx.router.post('/checkin', ctx.requireAuth(), async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      res.json(await presence.checkIn(userId, 'MANUAL'));
    });

    ctx.router.post('/checkout', ctx.requireAuth(), async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      await presence.checkOut(userId, 'MANUAL');
      res.json({ ok: true });
    });

    // ── Webhook Bitrix24 ──────────────────────────────────────────────────────
    // Configurar en Bitrix24 → OnTimeMenOpen / OnTimeMenClose
    // URL: POST /api/v1/p/office/bitrix/webhook
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

    // ── Layout ────────────────────────────────────────────────────────────────

    ctx.router.get('/layout', ctx.requireAuth(), async (_req, res) => {
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

    ctx.router.patch('/layout/position', ctx.requireAuth(), async (req, res) => {
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
        create: { userId: user.id, isInOffice: false, status: 'AWAY' },
        update: {},
      });
    });

    ctx.hooks.declareHook('office.user.checked_in');
    ctx.hooks.declareHook('office.user.checked_out');
    ctx.hooks.declareHook('office.user.status_changed');
    ctx.hooks.declareHook('office.user.moved');

    // ── Cron: auto-checkout por inactividad (>8h) ─────────────────────────────
    ctx.cron('*/5 * * * *', async () => {
      const threshold = new Date(Date.now() - 8 * 60 * 60 * 1000);
      const stale = await ctx.prisma.presenceStatus.findMany({
        where: { isInOffice: true, lastSeenAt: { lt: threshold } },
      });
      for (const p of stale) {
        await presence.checkOut((p as any).userId, 'API');
        ctx.logger.warn(`Auto checkout por inactividad: ${(p as any).userId}`);
      }
    });
  },

  async onDeactivate() {
    // cron jobs y SSE clients se limpian automáticamente por el core
  },
};

export default plugin;
