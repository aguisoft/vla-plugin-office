import type { PluginDefinition } from '@vla/plugin-sdk';
import { PresenceService } from './services/presence.service';
import { LayoutService } from './services/layout.service';
import { SnapshotService } from './services/snapshot.service';
import { BitrixService } from './services/bitrix.service';

const plugin: PluginDefinition = {
  async register(ctx) {
    ctx.logger.log('Office plugin iniciado');

    const presence = new PresenceService(ctx);
    const layout   = new LayoutService(ctx);
    const bitrix   = new BitrixService(ctx);
    const snapshot = new SnapshotService(ctx, bitrix);

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

    ctx.router.get('/presence/all', ctx.requireAuth(), async (_req, res) => {
      res.json(await presence.getAllIncludingOffline());
    });

    ctx.router.get('/presence/:userId', ctx.requireAuth(), async (req, res) => {
      const record = await presence.getOne(req.params.userId);
      if (!record) return res.status(404).json({ message: 'Usuario no encontrado' });
      res.json(record);
    });

    ctx.router.patch('/presence/status', ctx.requireAuth(), async (req, res) => {
      const { status, statusMessage } = req.body as { status: string; statusMessage?: string };
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      res.json(await presence.updateStatus(userId as any, status as any, statusMessage));
    });

    // ── Check-in / Check-out manual ────────────────────────────────────────────

    ctx.router.post('/checkin', ctx.requireAuth(), async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      res.json(await presence.checkIn(userId, 'WEB'));
    });

    ctx.router.post('/checkout', ctx.requireAuth(), async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      await presence.checkOut(userId, 'WEB');
      res.json({ ok: true });
    });

    // ── Snapshot (users + presence + avatars + bitrix photos) ─────────────────

    ctx.router.get('/snapshot', ctx.requireAuth(), async (_req, res) => {
      res.json(await snapshot.getAll());
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

    // Config: leer la configuración actual de Bitrix (admin)
    ctx.router.get('/bitrix/config', ctx.requireAuth('ADMIN'), (_req, res) => {
      const url = bitrix.getWebhookUrl();
      res.json({
        configured: bitrix.isConfigured(),
        webhookUrl: url ? url.replace(/\/rest\/\d+\/[^/]+\//, '/rest/****/*****/') : null,
      });
    });

    // Config: guardar webhook URL (admin)
    ctx.router.patch('/bitrix/config', ctx.requireAuth('ADMIN'), async (req, res) => {
      const { bitrixWebhookUrl } = req.body as { bitrixWebhookUrl: string };
      if (!bitrixWebhookUrl?.startsWith('https://')) {
        return res.status(400).json({ message: 'bitrixWebhookUrl debe ser una URL HTTPS válida' });
      }
      await ctx.prisma.plugin.update({
        where: { name: ctx.plugin.name },
        data: { config: { ...ctx.plugin.config, bitrixWebhookUrl } as any },
      });
      // Actualizar en memoria
      (ctx.plugin.config as any).bitrixWebhookUrl = bitrixWebhookUrl;
      res.json({ ok: true });
    });

    // Test de conexión con Bitrix (admin)
    ctx.router.get('/bitrix/test', ctx.requireAuth('ADMIN'), async (_req, res) => {
      res.json(await bitrix.testConnection());
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
        create: { userId: user.id, isCheckedIn: false, status: 'OFFLINE' },
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
        where: { isCheckedIn: true, lastActivityAt: { lt: threshold } },
      });
      for (const p of stale) {
        await presence.checkOut((p as any).userId, 'WEB');
        ctx.logger.warn(`Auto checkout por inactividad: ${(p as any).userId}`);
      }
    });

    // ── Cron: sincronizar fotos de Bitrix cada 6 horas ────────────────────────
    ctx.cron('0 */6 * * *', async () => {
      await bitrix.syncPhotos();
    });

    // ── Helper: sync timeman → presence ───────────────────────────────────────
    async function runTimemanSync(): Promise<{ synced: number; errors: number }> {
      const statuses = await bitrix.syncTimemanStatuses();
      let synced = 0;
      let errors = 0;
      for (const { userId, isOpen } of statuses) {
        try {
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
      if (synced > 0) ctx.logger.log(`Timeman sync: ${synced} usuarios actualizados`);
      return { synced, errors };
    }

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
