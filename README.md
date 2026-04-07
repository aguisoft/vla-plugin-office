# vla-plugin-office

Plugin de **presencia en tiempo real** para VLA System. Check-in/check-out automático desde Bitrix24, estado por usuario, layout de oficina y eventos en tiempo real vía SSE.

## Prerequisitos

- Node.js 18+
- [vla-system](https://github.com/aguisoft/vla-system) clonado y corriendo (core)
- PostgreSQL + Redis (levantados con `docker compose up -d` en vla-system)

---

## Configuración inicial (una sola vez)

```bash
# 1. Clonar ambos repos en la misma carpeta padre
mkdir mis-proyectos && cd mis-proyectos
git clone https://github.com/aguisoft/vla-system.git
git clone https://github.com/aguisoft/vla-plugin-office.git

# 2. Instalar dependencias de cada uno
cd vla-system && npm install
cd ../vla-plugin-office && npm install

# 3. Configurar el core
cp vla-system/apps/api/.env.example vla-system/apps/api/.env
# Editar vla-system/apps/api/.env con tus credenciales de DB y Redis

# 4. Levantar infraestructura y preparar la DB
cd vla-system
docker compose up -d
npm run db:push -w @vla/api
npm run db:seed -w @vla/api   # crea admin: admin@vla.com / admin123
```

---

## Flujo de desarrollo diario

### Terminal 1 — Core corriendo
```bash
cd vla-system
npm run dev -w @vla/api   # API en :3001
```

### Terminal 2 — Plugin en modo watch + auto-install
```bash
cd vla-plugin-office

# Primera vez o cuando cambies código:
npm run dev
# → compila TypeScript
# → copia dist/ + plugin.json al core (storage/plugins/office/)
# → te dice que reinicies el core

# Luego reinicia el core (Terminal 1: Ctrl+C → npm run dev -w @vla/api)
```

### Ciclo completo de iteración
```
editar src/  →  npm run dev  →  reiniciar core  →  probar en http://localhost:3001/api/v1/p/office/
```

> **Tip**: usa `npm run dev:watch` para que TypeScript recompile solo al guardar.
> Cuando estés listo corre `npm run dev` (sin watch) para instalar en el core.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run build` | Compila TypeScript → `dist/` |
| `npm run build:watch` | Compila en modo watch (sin instalar) |
| `npm run dev` | Compila + copia al core local |
| `npm run dev:watch` | Solo watch (útil en segunda terminal) |
| `npm run release` | Compila + genera `office-1.0.0.vla.zip` para producción |

---

## Publicar en producción

```bash
npm run release
# → genera office-1.0.0.vla.zip
```

Subir desde el panel admin: **Admin → Módulos → Seleccionar .vla.zip**  
El servidor reinicia y carga el plugin automáticamente.

---

## Endpoints (`/api/v1/p/office/`)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/presence` | JWT | Usuarios en oficina |
| GET | `/presence/:userId` | JWT | Estado de un usuario |
| PATCH | `/presence/status` | JWT | Actualizar mi estado |
| POST | `/checkin` | JWT | Check-in manual |
| POST | `/checkout` | JWT | Check-out manual |
| POST | `/bitrix/webhook` | secret | Webhook Bitrix24 |
| GET | `/layout` | JWT | Layout activo + posiciones |
| GET | `/layout/all` | ADMIN | Todos los layouts |
| POST | `/layout` | ADMIN | Crear layout |
| POST | `/layout/:id/zones` | ADMIN | Añadir zona |
| PATCH | `/layout/position` | JWT | Mover mi posición |
| GET | `/events` | JWT | SSE stream en tiempo real |

---

## Real-time (SSE)

```typescript
const source = new EventSource('/api/v1/p/office/events', {
  headers: { Authorization: `Bearer ${token}` },
});
source.onmessage = (e) => {
  const event = JSON.parse(e.data);
  // { type: 'user:joined' | 'user:left' | 'user:status' | 'user:moved', userId, ... }
};
```

---

## Hooks emitidos

Otros plugins pueden reaccionar a estos eventos:

```typescript
ctx.hooks.registerAction('office.user.checked_in',    async ({ userId, source }) => {});
ctx.hooks.registerAction('office.user.checked_out',   async ({ userId }) => {});
ctx.hooks.registerAction('office.user.status_changed',async ({ userId, status }) => {});
ctx.hooks.registerAction('office.user.moved',         async ({ userId, zoneId, positionX, positionY }) => {});
```

---

## Configuración post-instalación

```bash
PATCH /api/v1/plugins/office/config
Authorization: Bearer <admin-token>
Content-Type: application/json

{ "config": { "bitrixWebhookSecret": "tu-secret-opcional" } }
```

---

## Integración Bitrix24

1. Bitrix24 → **Configuración → REST API → Webhooks entrantes**
2. Añadir eventos: `OnTimeMenOpen` y `OnTimeMenClose`
3. URL: `https://tu-dominio.com/api/v1/p/office/bitrix/webhook`
4. Mapear usuarios Bitrix ↔ VLA en la tabla `BitrixUserMapping`

---

## Estructura

```
src/
├── index.ts                     ← rutas, hooks y cron
└── services/
    ├── presence.service.ts      ← check-in/out, estado, SSE broadcast
    └── layout.service.ts        ← layout, zonas, posiciones
vendor/
└── plugin-sdk/                  ← @vla/plugin-sdk embebido (no modificar)
```
