# vla-plugin-office

Plugin de **presencia en tiempo real** para VLA System. Permite ver quién está en la oficina virtual, integrar check-in/check-out automático desde **Bitrix24** y gestionar el layout del espacio de trabajo.

## Funcionalidades

- Check-in / check-out manual o automático vía Bitrix24 webhook
- Estado personalizado (IN_OFFICE, REMOTE, BREAK, LUNCH, MEETING, AWAY)
- Real-time con **Server-Sent Events** (sin WebSocket adicional)
- Layout de oficina con salas, zonas y posiciones de usuarios
- Auto-checkout tras 8h de inactividad (cron cada 5 min)
- Hooks para que otros plugins reaccionen a eventos de presencia

## Prerequisitos

- [VLA System](https://github.com/aguisoft/vla-system) corriendo
- Los modelos Prisma `PresenceStatus`, `CheckInRecord`, `OfficeLayout`, `OfficeZone`, `OfficeZoneUser` y `BitrixUserMapping` deben existir en el schema del core

## Desarrollo local

```bash
npm install
npm run build:watch
```

## Publicar al sistema

```bash
npm run release
# genera office-1.0.0.vla.zip
# subir desde Admin → Módulos
```

## Configuración post-instalación

```bash
PATCH /api/v1/plugins/office/config
{ "config": { "bitrixWebhookSecret": "tu-secret" } }
```

## Endpoints  (`/api/v1/p/office/`)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | /presence | JWT | Usuarios en oficina |
| GET | /presence/:userId | JWT | Estado de un usuario |
| PATCH | /presence/status | JWT | Actualizar mi estado |
| POST | /checkin | JWT | Check-in manual |
| POST | /checkout | JWT | Check-out manual |
| POST | /bitrix/webhook | secret | Webhook Bitrix24 |
| GET | /layout | JWT | Layout activo |
| POST | /layout | ADMIN | Crear layout |
| POST | /layout/:id/zones | ADMIN | Añadir zona |
| PATCH | /layout/position | JWT | Mover posición |
| GET | /events | JWT | SSE real-time stream |

## Real-time (SSE)

```typescript
const source = new EventSource('/api/v1/p/office/events', {
  headers: { Authorization: `Bearer ${token}` },
});
source.onmessage = (e) => {
  const { type, userId } = JSON.parse(e.data);
  // type: 'user:joined' | 'user:left' | 'user:status' | 'user:moved'
};
```

## Hooks emitidos

```typescript
ctx.hooks.registerAction('office.user.checked_in',   async ({ userId, source }) => {});
ctx.hooks.registerAction('office.user.checked_out',  async ({ userId }) => {});
ctx.hooks.registerAction('office.user.status_changed', async ({ userId, status }) => {});
ctx.hooks.registerAction('office.user.moved',        async ({ userId, zoneId, positionX, positionY }) => {});
```

## Integración Bitrix24

1. Bitrix24 → REST API → Webhooks entrantes → eventos `OnTimeMenOpen` / `OnTimeMenClose`
2. URL: `https://tu-dominio/api/v1/p/office/bitrix/webhook`
3. Mapear usuarios Bitrix ↔ VLA en tabla `BitrixUserMapping`
