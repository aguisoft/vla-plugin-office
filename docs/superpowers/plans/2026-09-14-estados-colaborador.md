# Rediseño de estados de colaborador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar los 7 estados planos del plugin office por 10 estados con información de respaldo obligatoria, incluyendo 3 tipos de ausencia con rango de fechas y feriados por país con override individual.

**Architecture:** El estado del día vive en `PresenceStatus.status` (enum del core). Las ausencias y los feriados viven en tablas aparte y **nunca** se escriben en ese campo — el estado que ve la oficina se calcula al componer el snapshot, con precedencia ausencia > feriado > presencia. Toda la lógica de decisión va en funciones puras bajo `src/lib/` probadas con vitest sin mocks; los servicios quedan como capa fina de I/O. Es el mismo patrón que usa `vla-plugin-cobros`.

**Tech Stack:** TypeScript, Prisma 5.7 sobre PostgreSQL (schemas `core` y `virtual_office`), Express vía `ctx.router` del plugin SDK, Redis vía `ctx.redis`, React 18 + Vite + Tailwind en el frontend, vitest para pruebas.

**Spec:** [`docs/superpowers/specs/2026-09-14-estados-colaborador-design.md`](../specs/2026-09-14-estados-colaborador-design.md)

## Global Constraints

- **Dos repos.** `vla-system` (core) y `vla-plugin-office` (plugin). El orden de deploy es **migración del core primero, `.vla.zip` después**. Invertirlo hace que el plugin escriba estados que el enum rechaza.
- **Zona horaria.** El API y Postgres corren en UTC; la operación es UTC-6. Ninguna fecha se calcula con la zona del proceso. Todo pasa por los helpers de `src/lib/local-date.ts` con la zona que sale del setting `TIMEZONE`, que arranca en `America/Costa_Rica`.
- **Mínimo de justificación:** 10 caracteres después de recortar espacios. La autoridad es `MIN_JUSTIFICATION` en `src/lib/status-rules.ts`; el frontend lleva su propia copia en `frontend/src/statusConfig.ts` porque son builds separados y el `tsconfig` del frontend solo incluye `src`. Si se desincronizan, el peor caso es que el modal habilite el botón y el backend responda 400 — molesto, pero no corrompe datos. Al cambiar el número hay que tocar los dos archivos.
- **Vencimiento de invitación:** 15 minutos. Constante única `INVITE_TTL_MS` en `src/lib/meeting-invites.ts`.
- **País por defecto:** `"CR"`. Setting `DEFAULT_COUNTRY` del plugin.
- **Enum en inglés, etiquetas en español.** `OfficeStatus` queda en inglés (ya existe así y lo consume el core). `AbsenceType` es nuevo y va en español: `PERMISO`, `VACACIONES`, `INCAPACIDAD`. Las etiquetas que ve el usuario son siempre español.
- **`OFFLINE` no se pide desde la API.** Lo escribe solo el sistema, en check-out.
- **Las justificaciones restringidas se omiten en el backend.** No se mandan vacías ni se ocultan en el frontend: el texto no viaja al cliente sin permiso.
- **Estados que exigen justificación:** `FOCUS`, `IN_MEETING_INTERNAL`, `IN_MEETING_EXTERNAL`, `BRB`, más `PERMISO` e `INCAPACIDAD` en ausencias y el override de feriado.
- **Justificación pública:** `FOCUS`, `IN_MEETING_INTERNAL`, `IN_MEETING_EXTERNAL`, `BRB`, `FERIADO`. **Restringida:** `PERMISO`, `INCAPACIDAD`.

## Accesores del SDK — leer antes de escribir código

Cuatro cosas que no son lo que uno supondría. Verificadas contra
`vla-system/apps/api/src/core/plugin-loader/plugin-context.factory.ts`.

**1. El id del usuario está en `sub`, no en `id`.** `req.user` es el payload del
JWT. Todo el código existente del plugin usa `(req as any).user?.sub` —
[`index.ts:81`](../../../src/index.ts#L81). Usar `.id` da `undefined` y el
endpoint contesta 401.

**2. No hay chequeo imperativo de permisos.** El SDK solo expone
`requirePermission(perm)` como middleware. Los permisos ya vienen en el request,
así que la verificación es local y sin consulta a la base. Definir este helper
una vez en `src/index.ts` y usarlo en todas las tareas:

```ts
/**
 * ¿Este request tiene el permiso? Mismo criterio que el middleware
 * requirePermission del core, incluido el salto de ADMIN.
 */
function can(req: any, permission: string): boolean {
  if (req.user?.role === 'ADMIN') return true;
  return (req.user?.permissions ?? []).includes(permission);
}
```

**3. Los valores de configuración están en `ctx.plugin.config`, no en
`ctx.settings`.** `ctx.settings` es el *esquema* declarativo que el core usa para
generar la UI de administración. Los valores los hidrata `hydrateConfig()` desde
la base después de registrar el plugin, sobre `ctx.plugin.config`. Se leen dentro
del handler, no al registrar:

```ts
const tz = () => (ctx.plugin.config.TIMEZONE as string) || DEFAULT_TZ;
const defaultCountry = () => (ctx.plugin.config.DEFAULT_COUNTRY as string) || 'CR';
```

Al escribir la configuración, `PATCH /plugins/office/config` **reemplaza el
objeto completo, no hace merge**: hay que mandar siempre la configuración entera
o se pierden las claves que se omitan.

**4. Los servicios no pueden consultar permisos.** No reciben el `req`. El que
los necesite los recibe como dato: `SnapshotService.getAll()` toma un objeto
`{ userId, hasManage }` que arma el endpoint con `can(req, …)`.

## Estructura de archivos

### Core — `vla-system`

| Archivo | Responsabilidad |
|---|---|
| `apps/api/prisma/schema.prisma` | Enum `OfficeStatus` nuevo, 5 modelos nuevos, columnas nuevas |
| `apps/api/prisma/migrations/20260914120000_office_states_redesign/migration.sql` | Migración escrita a mano: mueve filas, recrea el tipo, crea tablas |
| `apps/api/prisma/migrations/20260914120000_office_states_redesign/rollback.sql` | Reversa manual. Prisma no corre `down`; se ejecuta con `psql` si hace falta |
| `packages/shared/src/types/office.types.ts` | `PresenceStatusEnum` compartido |
| `packages/plugin-sdk/src/types.ts` | Expone los modelos nuevos en `PluginPrismaClient` y los permisos |
| `apps/web/src/lib/utils.ts` | `STATUS_CONFIG`: `Record` exhaustivo, rompe el build hasta actualizarlo |
| `apps/web/src/hooks/usePresence.ts` | Firma de `changeStatus` |

### Plugin — lógica pura, `src/lib/`

Cada archivo tiene su `.test.ts` al lado. Sin mocks: entran datos, salen datos.

| Archivo | Responsabilidad |
|---|---|
| `local-date.ts` | Convertir entre instantes UTC y días locales. Base de todo lo demás |
| `status-rules.ts` | Qué estado exige qué payload. Validación de `PATCH /presence/status` |
| `absence-validation.ts` | Rangos válidos, permiso del mismo día, detección de solapes |
| `holiday-resolver.ts` | Feriado efectivo hoy considerando overrides. Validación de mismo mes |
| `state-resolver.ts` | Precedencia ausencia > feriado > presencia |
| `justification-visibility.ts` | Quién puede leer la justificación de quién |
| `meeting-invites.ts` | Máquina de estados de la invitación y su vencimiento |

### Plugin — servicios, `src/services/`

| Archivo | Responsabilidad |
|---|---|
| `absence.service.ts` | **Crear.** CRUD de `AbsenceRecord` y consulta de ausencias activas |
| `holiday.service.ts` | **Crear.** CRUD de `Holiday` y de `HolidayOverride` |
| `meeting.service.ts` | **Crear.** Invitaciones, aceptación, cancelación en cascada |
| `org.service.ts` | **Crear.** Resolver jefe directo y país con override |
| `presence.service.ts` | Modificar: `justification`, rangos, `meetingId` |
| `snapshot.service.ts` | Modificar: `getAll({ userId, hasManage })`, resolver, filtro de visibilidad |
| `bitrix.service.ts` | Modificar: `syncOrgStructure()` con departamento y país |
| `../index.ts` | Modificar: endpoints nuevos, validación, blindaje del cron, permisos |

### Plugin — frontend, `frontend/src/`

| Archivo | Responsabilidad |
|---|---|
| `statusConfig.ts` | **Crear.** Fuente única de etiqueta, color, ícono y payload por estado |
| `components/JustificationModal.tsx` | **Crear.** Texto de respaldo con mínimo de caracteres |
| `components/TimeRangeModal.tsx` | **Crear.** Almuerzo |
| `components/DateRangeModal.tsx` | **Crear.** Vacaciones e incapacidad |
| `components/PermisoModal.tsx` | **Crear.** Una fecha más hora inicio y fin |
| `components/HolidayOverrideModal.tsx` | **Crear.** Mover un feriado dentro del mes |
| `components/ParticipantPicker.tsx` | **Crear.** Selección de compañeros, ausentes deshabilitados |
| `components/MeetingInviteModal.tsx` | **Crear.** Invitación entrante |
| `components/HolidayAdminPanel.tsx` | **Crear.** CRUD de feriados por país |
| `components/HoverCard.tsx` | Modificar: justificación, "vuelve el", almuerzo vencido |
| `components/ZoneTile.tsx` | Modificar: usa `statusConfig`, pinta ausentes |
| `components/ZoneListView.tsx` | Modificar: igual |
| `App.tsx` | Modificar: quita `STATUS_CFG`, cablea modales e invitaciones |
| `types.ts`, `api.ts` | Modificar: campos y endpoints nuevos |

## Fases

Cada fase cierra en un estado desplegable.

| Fase | Tareas | Al terminar |
|---|---|---|
| 0 — Andamiaje y core | 1–4 | Esquema migrado, builds del core verdes |
| 1 — Lógica pura | 5–11 | Toda la decisión probada, sin tocar I/O |
| 2 — Servicios y API | 12–18 | API completa y cron blindado. La UI vieja degrada pero funciona |
| 3 — Frontend | 19–24 | Feature completa |

---

## Fase 0 — Andamiaje y core

### Task 1: Montar vitest en el plugin

El plugin no tiene pruebas: no hay script `test`, ni vitest, ni un solo `*.test.ts`. Sin esto no se puede hacer TDD en ninguna tarea siguiente. Se copia el arreglo de `vla-plugin-cobros`.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/smoke.test.ts` (se borra en el Step 6)

**Interfaces:**
- Consumes: nada
- Produces: `npm test` corre `vitest run` sobre `src/**/*.test.ts`

- [ ] **Step 1: Instalar vitest**

```bash
cd vla-plugin-office
npm install --save-dev vitest@^4.1.8
```

- [ ] **Step 2: Crear `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'frontend/**'],
  },
});
```

- [ ] **Step 3: Agregar los scripts a `package.json`**

Dentro de `"scripts"`, antes de `"build"`:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 4: Escribir una prueba de humo**

Archivo `src/lib/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest', () => {
  it('corre', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Verificar que corre**

Run: `npm test`
Expected: PASS, 1 prueba.

- [ ] **Step 6: Borrar la prueba de humo y commitear**

```bash
rm src/lib/smoke.test.ts
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest to office plugin"
```

---

### Task 2: Enum del core y migración SQL

Postgres no permite quitar valores de un enum en caliente. `apps/api/package.json` solo expone `db:push`, que fallaría o exigiría `--accept-data-loss`. La migración va escrita a mano y el orden importa: primero se mueven las filas, después se recrea el tipo.

**Files:**
- Modify: `vla-system/apps/api/prisma/schema.prisma:224-234`
- Create: `vla-system/apps/api/prisma/migrations/20260914120000_office_states_redesign/migration.sql`
- Create: `vla-system/apps/api/prisma/migrations/20260914120000_office_states_redesign/rollback.sql`

**Interfaces:**
- Consumes: nada
- Produces: enum `OfficeStatus` con `AVAILABLE | IN_MEETING_INTERNAL | IN_MEETING_EXTERNAL | FOCUS | LUNCH | BRB | OFFLINE`

- [ ] **Step 1: Respaldar la tabla antes de tocar nada**

La migración pierde qué filas eran `BUSY` y eso no se puede recuperar con el rollback.

```bash
docker exec -i vla_postgres pg_dump -U vla_user -d vla_db \
  --table='virtual_office."PresenceStatus"' --data-only \
  > /tmp/presence-status-backup-$(date +%Y%m%d).sql
wc -l /tmp/presence-status-backup-*.sql
```

- [ ] **Step 2: Contar las filas que van a cambiar**

```bash
docker exec -i vla_postgres psql -U vla_user -d vla_db -c \
  "SELECT status, count(*) FROM virtual_office.\"PresenceStatus\" GROUP BY status ORDER BY 2 DESC;"
```

Anotar el conteo de `BUSY` e `IN_MEETING`. Es el número que tiene que aparecer en `AVAILABLE` al terminar.

- [ ] **Step 3: Editar el enum en `schema.prisma`**

Reemplazar el bloque `enum OfficeStatus` (líneas 224-234) por:

```prisma
enum OfficeStatus {
  AVAILABLE
  IN_MEETING_INTERNAL
  IN_MEETING_EXTERNAL
  FOCUS
  LUNCH
  BRB
  OFFLINE

  @@schema("virtual_office")
}
```

- [ ] **Step 4: Escribir la migración a mano**

Archivo `migration.sql`:

```sql
-- 1. Sacar las filas de los valores que se eliminan.
--    Las dos van a AVAILABLE y no a FOCUS ni IN_MEETING_EXTERNAL: esos dos
--    exigen justificación y las filas viejas no la tienen, así que mapearlas
--    ahí crearía registros que violan su propia regla. Son estados del día que
--    el cron de timeman reescribe en 2 minutos; no se pierde nada real.
UPDATE virtual_office."PresenceStatus"
   SET status = 'AVAILABLE'
 WHERE status IN ('BUSY', 'IN_MEETING');

-- 2. Recrear el tipo. El DEFAULT se suelta antes de cambiar el tipo de la
--    columna y se vuelve a poner después; si no, Postgres rechaza el ALTER.
ALTER TYPE virtual_office."OfficeStatus" RENAME TO "OfficeStatus_old";

CREATE TYPE virtual_office."OfficeStatus" AS ENUM (
  'AVAILABLE',
  'IN_MEETING_INTERNAL',
  'IN_MEETING_EXTERNAL',
  'FOCUS',
  'LUNCH',
  'BRB',
  'OFFLINE'
);

ALTER TABLE virtual_office."PresenceStatus"
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE virtual_office."OfficeStatus"
    USING status::text::virtual_office."OfficeStatus",
  ALTER COLUMN status SET DEFAULT 'OFFLINE';

DROP TYPE virtual_office."OfficeStatus_old";
```

- [ ] **Step 5: Escribir la reversa manual**

Prisma no ejecuta archivos `down`. Este se corre a mano con `psql` y va versionado para que exista cuando se necesite.

Archivo `rollback.sql`:

```sql
-- Reversa manual. NO recupera qué filas eran BUSY: ese dato se perdió en el
-- paso 1 de la migración hacia adelante. Restaurar desde el respaldo de
-- PresenceStatus si hace falta el valor original.
UPDATE virtual_office."PresenceStatus"
   SET status = 'AVAILABLE'
 WHERE status IN ('IN_MEETING_INTERNAL', 'IN_MEETING_EXTERNAL');

ALTER TYPE virtual_office."OfficeStatus" RENAME TO "OfficeStatus_new";

CREATE TYPE virtual_office."OfficeStatus" AS ENUM (
  'AVAILABLE', 'BUSY', 'IN_MEETING', 'FOCUS', 'LUNCH', 'BRB', 'OFFLINE'
);

ALTER TABLE virtual_office."PresenceStatus"
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE virtual_office."OfficeStatus"
    USING status::text::virtual_office."OfficeStatus",
  ALTER COLUMN status SET DEFAULT 'OFFLINE';

DROP TYPE virtual_office."OfficeStatus_new";
```

- [ ] **Step 6: Aplicar y verificar**

```bash
cd vla-system/apps/api
npx prisma migrate deploy
npx prisma generate
```

Verificar que el conteo del Step 2 cuadre:

```bash
docker exec -i vla_postgres psql -U vla_user -d vla_db -c \
  "SELECT unnest(enum_range(NULL::virtual_office.\"OfficeStatus\"));"
docker exec -i vla_postgres psql -U vla_user -d vla_db -c \
  "SELECT status, count(*) FROM virtual_office.\"PresenceStatus\" GROUP BY status;"
```

Expected: 7 valores, ninguno `BUSY` ni `IN_MEETING`. El conteo de `AVAILABLE` subió exactamente lo que sumaban `BUSY` + `IN_MEETING`.

- [ ] **Step 7: Verificar que el DEFAULT sobrevivió**

Es el error clásico de este tipo de migración: la columna queda sin default y las filas nuevas fallan.

```bash
docker exec -i vla_postgres psql -U vla_user -d vla_db -c \
  "SELECT column_default FROM information_schema.columns
    WHERE table_schema='virtual_office' AND table_name='PresenceStatus'
      AND column_name='status';"
```

Expected: `'OFFLINE'::virtual_office."OfficeStatus"`

- [ ] **Step 8: Commit**

```bash
cd vla-system
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/
git commit -m "feat(office): split IN_MEETING into internal/external, drop BUSY"
```

---

### Task 3: Modelos nuevos en el core

Cinco modelos y dos enums nuevos, todos en el schema `virtual_office`, más columnas nuevas en `PresenceStatus` y `BitrixUserMapping`.

**Files:**
- Modify: `vla-system/apps/api/prisma/schema.prisma`
- Modify: `vla-system/apps/api/prisma/migrations/20260914120000_office_states_redesign/migration.sql` (se le agrega al final)

**Interfaces:**
- Consumes: enum `OfficeStatus` de la Task 2
- Produces: modelos `AbsenceRecord`, `Holiday`, `HolidayOverride`, `MeetingInvite`, `UserProfileOverride`; enums `AbsenceType`, `InviteState`; columnas `PresenceStatus.justification`, `.statusStartsAt`, `.statusEndsAt`, `.meetingId`; columnas `BitrixUserMapping.departmentId`, `.isDepartmentHead`, `.country`

- [ ] **Step 1: Agregar las columnas nuevas a `PresenceStatus`**

Dentro del modelo, antes de la línea `user User @relation(...)`:

```prisma
  justification  String?
  statusStartsAt DateTime?
  statusEndsAt   DateTime?
  meetingId      String?
```

- [ ] **Step 2: Agregar los enums y modelos nuevos**

Después del bloque `enum OfficeStatus`:

```prisma
enum AbsenceType {
  PERMISO
  VACACIONES
  INCAPACIDAD

  @@schema("virtual_office")
}

model AbsenceRecord {
  id            String      @id @default(uuid())
  userId        String
  type          AbsenceType
  startAt       DateTime
  endAt         DateTime
  justification String?
  createdBy     String
  createdAt     DateTime    @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, startAt, endAt])
  @@index([startAt, endAt])
  @@schema("virtual_office")
}

model Holiday {
  id      String   @id @default(uuid())
  date    DateTime @db.Date
  name    String
  country String

  overrides HolidayOverride[]

  @@unique([date, country])
  @@index([country, date])
  @@schema("virtual_office")
}

model HolidayOverride {
  id            String   @id @default(uuid())
  userId        String
  holidayId     String
  newDate       DateTime @db.Date
  justification String
  createdAt     DateTime @default(now())

  holiday Holiday @relation(fields: [holidayId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, holidayId])
  @@index([userId, newDate])
  @@schema("virtual_office")
}

enum InviteState {
  PENDING
  ACCEPTED
  DECLINED
  CANCELLED
  EXPIRED

  @@schema("virtual_office")
}

model MeetingInvite {
  id          String      @id @default(uuid())
  meetingId   String
  hostId      String
  inviteeId   String
  state       InviteState @default(PENDING)
  createdAt   DateTime    @default(now())
  respondedAt DateTime?

  @@index([inviteeId, state])
  @@index([meetingId])
  @@schema("virtual_office")
}

model UserProfileOverride {
  id            String  @id @default(uuid())
  userId        String  @unique
  managerUserId String?
  country       String?

  @@schema("virtual_office")
}
```

- [ ] **Step 3: Agregar las columnas a `BitrixUserMapping`**

Dentro del modelo, antes de la relación:

```prisma
  departmentId     String?
  isDepartmentHead Boolean @default(false)
  country          String?
```

- [ ] **Step 4: Agregar las relaciones inversas al modelo `User`**

Prisma exige el otro lado de cada relación. Dentro de `model User`, junto a las relaciones que ya están:

```prisma
  absenceRecords       AbsenceRecord[]
  holidayOverrides     HolidayOverride[]
```

- [ ] **Step 5: Generar el SQL y pegarlo en la migración existente**

```bash
cd vla-system/apps/api
# NO uses --from-migrations en este proyecto: con multiSchema activo genera
# 300+ lineas que hacen DROP de todas las tablas y tipos y los recrean.
# Verificado tres veces con shadow databases reales. Contra una base con datos,
# los destruye. Usa la comparacion estatica de dos archivos de schema:
git show HEAD:apps/api/prisma/schema.prisma > /tmp/schema-antes.prisma
npx prisma migrate diff \
  --from-schema-datamodel /tmp/schema-antes.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script
# INSPECCIONA la salida antes de aplicarla: debe traer solo CREATE TYPE,
# CREATE TABLE, CREATE INDEX y ALTER TABLE ... ADD COLUMN. Si aparece un DROP,
# para: el comando salio mal y aplicarlo pierde datos.
```

Pegar la salida al final de `20260914120000_office_states_redesign/migration.sql`, bajo un comentario `-- 3. Tablas y columnas nuevas`.

Si no hay `SHADOW_DATABASE_URL` configurado, escribir los `CREATE TYPE` / `CREATE TABLE` / `ALTER TABLE` a mano siguiendo el esquema de arriba — son mecánicos.

- [ ] **Step 6: Agregar los DROP a la reversa**

Al inicio de `rollback.sql`, antes de lo que ya tiene:

```sql
DROP TABLE IF EXISTS virtual_office."UserProfileOverride";
DROP TABLE IF EXISTS virtual_office."MeetingInvite";
DROP TABLE IF EXISTS virtual_office."HolidayOverride";
DROP TABLE IF EXISTS virtual_office."Holiday";
DROP TABLE IF EXISTS virtual_office."AbsenceRecord";
DROP TYPE  IF EXISTS virtual_office."InviteState";
DROP TYPE  IF EXISTS virtual_office."AbsenceType";

ALTER TABLE virtual_office."PresenceStatus"
  DROP COLUMN IF EXISTS justification,
  DROP COLUMN IF EXISTS "statusStartsAt",
  DROP COLUMN IF EXISTS "statusEndsAt",
  DROP COLUMN IF EXISTS "meetingId";

ALTER TABLE virtual_office."BitrixUserMapping"
  DROP COLUMN IF EXISTS "departmentId",
  DROP COLUMN IF EXISTS "isDepartmentHead",
  DROP COLUMN IF EXISTS country;
```

- [ ] **Step 7: Aplicar y verificar**

```bash
cd vla-system/apps/api
npx prisma migrate deploy
npx prisma generate
docker exec -i vla_postgres psql -U vla_user -d vla_db -c "\dt virtual_office.*"
```

Expected: aparecen `AbsenceRecord`, `Holiday`, `HolidayOverride`, `MeetingInvite`, `UserProfileOverride`.

- [ ] **Step 8: Commit**

```bash
cd vla-system
git add apps/api/prisma/
git commit -m "feat(office): add absence, holiday, meeting invite and org override models"
```

---

### Task 4: Propagar el enum al core y exponer los modelos en el SDK

`apps/web/src/lib/utils.ts` tiene `STATUS_CONFIG` como `Record<PresenceStatusEnum, …>` exhaustivo: el build del core queda roto hasta que se actualice. Y `ctx.prisma` es un cliente restringido, así que los modelos nuevos no son visibles para el plugin hasta declararlos.

**Files:**
- Modify: `vla-system/packages/shared/src/types/office.types.ts:1-10`
- Modify: `vla-system/packages/plugin-sdk/src/types.ts`
- Modify: `vla-system/apps/web/src/lib/utils.ts:9-17`
- Modify: `vla-system/apps/web/src/hooks/usePresence.ts:33`

**Interfaces:**
- Consumes: enum `OfficeStatus` de la Task 2, modelos de la Task 3
- Produces: `PresenceStatusEnum` con los 7 valores nuevos; `ctx.prisma.absenceRecord`, `.holiday`, `.holidayOverride`, `.meetingInvite`, `.userProfileOverride`; permisos `read:absences`, `write:absences`, `read:holidays`, `write:holidays`, `read:meetings`, `write:meetings`, `read:org`, `write:org`

- [ ] **Step 1: Actualizar el enum compartido**

En `packages/shared/src/types/office.types.ts`, reemplazar los miembros `BUSY` e `IN_MEETING`:

```ts
export enum PresenceStatusEnum {
  AVAILABLE = 'AVAILABLE',
  IN_MEETING_INTERNAL = 'IN_MEETING_INTERNAL',
  IN_MEETING_EXTERNAL = 'IN_MEETING_EXTERNAL',
  FOCUS = 'FOCUS',
  LUNCH = 'LUNCH',
  BRB = 'BRB',
  OFFLINE = 'OFFLINE',
}
```

- [ ] **Step 2: Verificar que el build del core rompe donde se espera**

Run: `cd vla-system && npm run build -w @vla/shared && npm run build -w @vla/web`
Expected: FAIL en `apps/web/src/lib/utils.ts` — el `Record` exhaustivo le falta `IN_MEETING_INTERNAL` e `IN_MEETING_EXTERNAL` y le sobran `BUSY` e `IN_MEETING`.

Este paso existe para confirmar que el acoplamiento es real y que no hay otro consumidor escondido. Si rompe en algún archivo que no está en esta tarea, agregarlo antes de seguir.

- [ ] **Step 3: Actualizar `STATUS_CONFIG` en el core web**

En `apps/web/src/lib/utils.ts`, reemplazar las entradas de `BUSY` e `IN_MEETING`:

```ts
  [PresenceStatusEnum.IN_MEETING_INTERNAL]: { label: 'En reunión interna', color: '#c084fc', emoji: '🟣', pulse: false },
  [PresenceStatusEnum.IN_MEETING_EXTERNAL]: { label: 'En reunión externa', color: '#7c3aed', emoji: '🟪', pulse: false },
```

Las etiquetas usan la terminología de la lista de estados. Los colores son los mismos que va a usar el plugin, para que las dos UIs no se contradigan.

- [ ] **Step 4: Verificar que el build del core pasa**

Run: `cd vla-system && npm run build -w @vla/shared && npm run build -w @vla/web && npm run build -w @vla/api`
Expected: PASS los tres.

Si `usePresence.ts:33` rompe, es porque el tipo del parámetro `status` quedó desalineado; ya toma `PresenceStatusEnum`, así que debería resolverse solo al recompilar `@vla/shared`.

- [ ] **Step 5: Exponer los modelos nuevos en el SDK**

En `packages/plugin-sdk/src/types.ts`, en la interfaz `PluginPrismaClient`, agregar los cinco delegados siguiendo el estilo de los que ya están (`presenceStatus`, `checkInRecord`, …), y agregar al comentario del mapeo de permisos:

```ts
/**
 *  read:absences      → ctx.prisma.absenceRecord.findMany(...)
 *  write:absences     → ctx.prisma.absenceRecord.create(...)
 *  read:holidays      → ctx.prisma.holiday.findMany(...) / holidayOverride
 *  write:holidays     → ctx.prisma.holiday.create(...)   / holidayOverride
 *  read:meetings      → ctx.prisma.meetingInvite.findMany(...)
 *  write:meetings     → ctx.prisma.meetingInvite.update(...)
 *  read:org           → ctx.prisma.userProfileOverride.findMany(...)
 *  write:org          → ctx.prisma.userProfileOverride.upsert(...)
 */
```

- [ ] **Step 6: Construir el SDK y copiarlo al vendor del plugin**

El plugin consume el SDK desde `vendor/plugin-sdk`, que es una copia. Si no se actualiza, el plugin no ve los tipos nuevos.

```bash
cd vla-system && npm run build -w @vla/plugin-sdk
cp -r packages/plugin-sdk/dist/* ../vla-plugin-office/vendor/plugin-sdk/dist/
cd ../vla-plugin-office && npx tsc --noEmit
```

Expected: el `tsc` del plugin pasa. Todavía no usa los modelos nuevos, pero confirma que la copia del SDK no rompió nada.

- [ ] **Step 7: Declarar los permisos en `plugin.json`**

En `vla-plugin-office/plugin.json`, el arreglo `permissions` pasa a:

```json
  "permissions": [
    "read:users",
    "read:presence",
    "write:presence",
    "read:checkins",
    "write:checkins",
    "read:absences",
    "write:absences",
    "read:holidays",
    "write:holidays",
    "read:meetings",
    "write:meetings",
    "read:org",
    "write:org"
  ],
```

- [ ] **Step 8: Commit en los dos repos**

```bash
cd vla-system
git add packages/shared packages/plugin-sdk apps/web
git commit -m "feat(office): propagate status enum, expose new models in plugin SDK"

cd ../vla-plugin-office
git add plugin.json vendor/plugin-sdk
git commit -m "chore: sync plugin SDK, declare absence/holiday/meeting/org permissions"
```

---

## Fase 1 — Lógica pura

Todas las tareas de esta fase son funciones que reciben datos y devuelven datos. Sin Prisma, sin Redis, sin mocks. Es el patrón de `vla-plugin-cobros/src/lib/`.

### Task 5: Helpers de fecha local

Base de todo lo demás. El API y Postgres corren en UTC y la operación es UTC-6; un bug de este tipo ya se dio en el plugin de cobros, donde las fechas se corrían a partir de las 18:00 hora local. Ninguna otra tarea calcula fechas por su cuenta.

**Files:**
- Create: `src/lib/local-date.ts`
- Test: `src/lib/local-date.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `localDateString(instant: Date, tz: string): string` → `"2026-09-14"`
  - `localDayStart(instant: Date, tz: string): Date`
  - `localDayEnd(instant: Date, tz: string): Date`
  - `sameLocalMonth(a: Date, b: Date, tz: string): boolean`
  - `zonedTimeToUtc(y: number, m: number, d: number, h: number, mi: number, s: number, tz: string): Date`
  - `DEFAULT_TZ: string` = `'America/Costa_Rica'`

- [ ] **Step 1: Escribir las pruebas que fallan**

Archivo `src/lib/local-date.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  localDateString,
  localDayStart,
  localDayEnd,
  sameLocalMonth,
  zonedTimeToUtc,
  DEFAULT_TZ,
} from './local-date';

const TZ = DEFAULT_TZ; // America/Costa_Rica, UTC-6 sin horario de verano

describe('localDateString', () => {
  it('da el día local, no el de UTC, después de las 18:00', () => {
    // 2026-09-15T02:30:00Z son las 20:30 del 14 en Costa Rica
    expect(localDateString(new Date('2026-09-15T02:30:00Z'), TZ)).toBe('2026-09-14');
  });

  it('coincide con UTC durante la mañana local', () => {
    expect(localDateString(new Date('2026-09-14T15:00:00Z'), TZ)).toBe('2026-09-14');
  });

  it('cruza al día siguiente a partir de las 06:00Z', () => {
    // 06:00Z es medianoche local, ya es día nuevo
    expect(localDateString(new Date('2026-09-14T06:00:00Z'), TZ)).toBe('2026-09-14');
    expect(localDateString(new Date('2026-09-14T05:59:59Z'), TZ)).toBe('2026-09-13');
  });
});

describe('localDayStart / localDayEnd', () => {
  it('medianoche local del 14 es 06:00Z del 14', () => {
    const start = localDayStart(new Date('2026-09-14T20:00:00Z'), TZ);
    expect(start.toISOString()).toBe('2026-09-14T06:00:00.000Z');
  });

  it('el fin del día local es 05:59:59.999Z del día siguiente', () => {
    const end = localDayEnd(new Date('2026-09-14T20:00:00Z'), TZ);
    expect(end.toISOString()).toBe('2026-09-15T05:59:59.999Z');
  });

  it('un instante de las 23:30 local cae dentro de su propio día', () => {
    const instant = new Date('2026-09-15T05:30:00Z'); // 23:30 del 14 local
    const start = localDayStart(instant, TZ);
    const end = localDayEnd(instant, TZ);
    expect(instant >= start && instant <= end).toBe(true);
    expect(localDateString(start, TZ)).toBe('2026-09-14');
  });
});

describe('sameLocalMonth', () => {
  it('true para dos fechas del mismo mes local', () => {
    expect(sameLocalMonth(
      new Date('2026-09-01T18:00:00Z'),
      new Date('2026-09-30T18:00:00Z'),
      TZ,
    )).toBe(true);
  });

  it('false cruzando de mes', () => {
    expect(sameLocalMonth(
      new Date('2026-09-30T18:00:00Z'),
      new Date('2026-10-01T18:00:00Z'),
      TZ,
    )).toBe(false);
  });

  it('usa el mes local, no el de UTC, en el borde del mes', () => {
    // 2026-10-01T03:00:00Z son las 21:00 del 30 de septiembre en Costa Rica
    expect(sameLocalMonth(
      new Date('2026-09-15T18:00:00Z'),
      new Date('2026-10-01T03:00:00Z'),
      TZ,
    )).toBe(true);
  });
});

describe('zonedTimeToUtc', () => {
  it('convierte una hora local a su instante UTC', () => {
    expect(zonedTimeToUtc(2026, 9, 14, 12, 0, 0, TZ).toISOString())
      .toBe('2026-09-14T18:00:00.000Z');
  });

  it('medianoche local', () => {
    expect(zonedTimeToUtc(2026, 9, 14, 0, 0, 0, TZ).toISOString())
      .toBe('2026-09-14T06:00:00.000Z');
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- local-date`
Expected: FAIL con `Failed to resolve import "./local-date"`.

- [ ] **Step 3: Implementar**

Archivo `src/lib/local-date.ts`:

```ts
export const DEFAULT_TZ = 'America/Costa_Rica';

interface Parts { y: number; m: number; d: number; h: number; mi: number; s: number }

/** Descompone un instante en las partes de reloj de la zona dada. */
function zonedParts(instant: Date, tz: string): Parts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    // 'en-US' con hour12:false devuelve 24 para la medianoche; se normaliza a 0
    h: Number(p.hour) % 24,
    mi: Number(p.minute),
    s: Number(p.second),
  };
}

/** Desfase de la zona respecto a UTC, en ms, para ese instante. */
function zoneOffsetMs(instant: Date, tz: string): number {
  const { y, m, d, h, mi, s } = zonedParts(instant, tz);
  const asIfUtc = Date.UTC(y, m - 1, d, h, mi, s);
  // instant.getTime() lleva milisegundos; asIfUtc solo hasta segundos
  return asIfUtc - (instant.getTime() - instant.getMilliseconds());
}

export function zonedTimeToUtc(
  y: number, m: number, d: number, h: number, mi: number, s: number, tz: string,
): Date {
  // Primera aproximación: tratar la hora local como si fuera UTC.
  const guess = new Date(Date.UTC(y, m - 1, d, h, mi, s));
  // Corregir con el desfase vigente en ese momento, y volver a medir en caso de
  // que la corrección haya cruzado un cambio de horario de verano.
  const once = new Date(guess.getTime() - zoneOffsetMs(guess, tz));
  return new Date(guess.getTime() - zoneOffsetMs(once, tz));
}

export function localDateString(instant: Date, tz: string): string {
  const { y, m, d } = zonedParts(instant, tz);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function localDayStart(instant: Date, tz: string): Date {
  const { y, m, d } = zonedParts(instant, tz);
  return zonedTimeToUtc(y, m, d, 0, 0, 0, tz);
}

export function localDayEnd(instant: Date, tz: string): Date {
  const { y, m, d } = zonedParts(instant, tz);
  const startOfNext = zonedTimeToUtc(y, m, d + 1, 0, 0, 0, tz);
  return new Date(startOfNext.getTime() - 1);
}

export function sameLocalMonth(a: Date, b: Date, tz: string): boolean {
  const pa = zonedParts(a, tz);
  const pb = zonedParts(b, tz);
  return pa.y === pb.y && pa.m === pb.m;
}
```

`Date.UTC` normaliza el día 32, así que `d + 1` funciona en fin de mes sin casos especiales.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- local-date`
Expected: PASS, 11 pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-date.ts src/lib/local-date.test.ts
git commit -m "feat: add timezone-aware local date helpers"
```

---

### Task 6: Reglas y validación de estados del día

Fuente única de qué exige cada estado. Arregla de paso que `PATCH /presence/status` hoy no valide nada: [`index.ts:83`](../../../src/index.ts#L83) hace `status as any` directo al servicio, así que se puede escribir cualquier string a la base.

**Files:**
- Create: `src/lib/status-rules.ts`
- Test: `src/lib/status-rules.test.ts`

**Interfaces:**
- Consumes: `localDateString` de la Task 5
- Produces:
  - tipos `OfficeStatus`, `AbsenceType`, `ResolvedStatus`
  - `MIN_JUSTIFICATION: number` = `10`
  - `SELECTABLE_STATUSES: OfficeStatus[]`
  - `NEEDS_JUSTIFICATION: Set<OfficeStatus>`
  - `PUBLIC_JUSTIFICATION: Set<ResolvedStatus>`
  - `ValidationError` = `{ field: string; message: string }`
  - `validateStatusInput(input: StatusInput, tz: string): ValidationError[]`

- [ ] **Step 1: Escribir las pruebas que fallan**

Archivo `src/lib/status-rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateStatusInput, MIN_JUSTIFICATION } from './status-rules';
import { DEFAULT_TZ } from './local-date';

const TZ = DEFAULT_TZ;
const ok = (input: any) => validateStatusInput(input, TZ);
const fields = (input: any) => ok(input).map(e => e.field);

describe('validateStatusInput — estado', () => {
  it('acepta AVAILABLE sin nada más', () => {
    expect(ok({ status: 'AVAILABLE' })).toEqual([]);
  });

  it('rechaza un estado que no existe en el enum', () => {
    expect(fields({ status: 'PARRANDA' })).toContain('status');
  });

  it('rechaza BUSY, que se eliminó', () => {
    expect(fields({ status: 'BUSY' })).toContain('status');
  });

  it('rechaza OFFLINE: lo escribe solo el sistema', () => {
    const errs = ok({ status: 'OFFLINE' });
    expect(errs.map(e => e.field)).toContain('status');
    expect(errs[0].message).toMatch(/sistema/i);
  });
});

describe('validateStatusInput — justificación', () => {
  const needsIt = ['FOCUS', 'IN_MEETING_INTERNAL', 'IN_MEETING_EXTERNAL', 'BRB'];

  for (const status of needsIt) {
    it(`${status} sin justificación falla`, () => {
      expect(fields({ status })).toContain('justification');
    });

    it(`${status} con ${MIN_JUSTIFICATION} caracteres pasa`, () => {
      const base: any = { status, justification: 'a'.repeat(MIN_JUSTIFICATION) };
      if (status === 'IN_MEETING_INTERNAL') base.participantIds = [];
      expect(ok(base)).toEqual([]);
    });
  }

  it(`falla con ${MIN_JUSTIFICATION - 1} caracteres`, () => {
    expect(fields({
      status: 'FOCUS',
      justification: 'a'.repeat(MIN_JUSTIFICATION - 1),
    })).toContain('justification');
  });

  it('no cuenta los espacios de los extremos', () => {
    expect(fields({ status: 'FOCUS', justification: '   corto   ' }))
      .toContain('justification');
  });

  it('AVAILABLE no la exige', () => {
    expect(ok({ status: 'AVAILABLE' })).toEqual([]);
  });

  it('LUNCH no la exige', () => {
    expect(ok({
      status: 'LUNCH',
      startsAt: '2026-09-14T18:00:00Z',
      endsAt: '2026-09-14T19:00:00Z',
    })).toEqual([]);
  });
});

describe('validateStatusInput — rango de LUNCH', () => {
  it('exige los dos extremos', () => {
    expect(fields({ status: 'LUNCH' })).toContain('startsAt');
  });

  it('exige que el fin sea posterior al inicio', () => {
    expect(fields({
      status: 'LUNCH',
      startsAt: '2026-09-14T19:00:00Z',
      endsAt: '2026-09-14T18:00:00Z',
    })).toContain('endsAt');
  });

  it('rechaza extremos iguales', () => {
    expect(fields({
      status: 'LUNCH',
      startsAt: '2026-09-14T18:00:00Z',
      endsAt: '2026-09-14T18:00:00Z',
    })).toContain('endsAt');
  });

  it('exige que los dos caigan el mismo día local', () => {
    // 18:00Z del 14 es mediodía local del 14; 08:00Z del 15 son las 02:00 del 15
    expect(fields({
      status: 'LUNCH',
      startsAt: '2026-09-14T18:00:00Z',
      endsAt: '2026-09-15T08:00:00Z',
    })).toContain('endsAt');
  });

  it('rechaza el rango en un estado que no es LUNCH', () => {
    expect(fields({
      status: 'AVAILABLE',
      startsAt: '2026-09-14T18:00:00Z',
      endsAt: '2026-09-14T19:00:00Z',
    })).toContain('startsAt');
  });
});

describe('validateStatusInput — participantes', () => {
  const just = 'reunión de seguimiento semanal';

  it('IN_MEETING_INTERNAL los acepta', () => {
    expect(ok({
      status: 'IN_MEETING_INTERNAL',
      justification: just,
      participantIds: ['u1', 'u2'],
    })).toEqual([]);
  });

  it('otro estado los rechaza', () => {
    expect(fields({
      status: 'IN_MEETING_EXTERNAL',
      justification: just,
      participantIds: ['u1'],
    })).toContain('participantIds');
  });

  it('rechaza ids duplicados', () => {
    expect(fields({
      status: 'IN_MEETING_INTERNAL',
      justification: just,
      participantIds: ['u1', 'u1'],
    })).toContain('participantIds');
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- status-rules`
Expected: FAIL con `Failed to resolve import "./status-rules"`.

- [ ] **Step 3: Implementar**

Archivo `src/lib/status-rules.ts`:

```ts
import { localDateString } from './local-date';

export type OfficeStatus =
  | 'AVAILABLE'
  | 'IN_MEETING_INTERNAL'
  | 'IN_MEETING_EXTERNAL'
  | 'FOCUS'
  | 'LUNCH'
  | 'BRB'
  | 'OFFLINE';

export type AbsenceType = 'PERMISO' | 'VACACIONES' | 'INCAPACIDAD';

/** Lo que ve la oficina: estado del día, ausencia o feriado. */
export type ResolvedStatus = OfficeStatus | AbsenceType | 'FERIADO';

export const MIN_JUSTIFICATION = 10;

export const ALL_STATUSES: OfficeStatus[] = [
  'AVAILABLE', 'IN_MEETING_INTERNAL', 'IN_MEETING_EXTERNAL',
  'FOCUS', 'LUNCH', 'BRB', 'OFFLINE',
];

/** Lo que el colaborador puede elegir. OFFLINE lo escribe solo el sistema. */
export const SELECTABLE_STATUSES: OfficeStatus[] = ALL_STATUSES
  .filter(s => s !== 'OFFLINE');

export const NEEDS_JUSTIFICATION = new Set<OfficeStatus>([
  'FOCUS', 'IN_MEETING_INTERNAL', 'IN_MEETING_EXTERNAL', 'BRB',
]);

export const NEEDS_TIME_RANGE = new Set<OfficeStatus>(['LUNCH']);

/** Estados cuya justificación puede leer cualquiera con office.view. */
export const PUBLIC_JUSTIFICATION = new Set<ResolvedStatus>([
  'FOCUS', 'IN_MEETING_INTERNAL', 'IN_MEETING_EXTERNAL', 'BRB', 'FERIADO',
]);

export interface StatusInput {
  status: string;
  justification?: string;
  startsAt?: string;
  endsAt?: string;
  participantIds?: string[];
}

export interface ValidationError {
  field: string;
  message: string;
}

export function isOfficeStatus(v: string): v is OfficeStatus {
  return (ALL_STATUSES as string[]).includes(v);
}

export function validateStatusInput(input: StatusInput, tz: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isOfficeStatus(input.status)) {
    return [{ field: 'status', message: `Estado inválido: ${input.status}` }];
  }
  if (input.status === 'OFFLINE') {
    return [{ field: 'status', message: 'OFFLINE lo escribe solo el sistema' }];
  }

  const status = input.status;

  // ── Justificación ────────────────────────────────────────────────────────
  const justification = (input.justification ?? '').trim();
  if (NEEDS_JUSTIFICATION.has(status)) {
    if (justification.length < MIN_JUSTIFICATION) {
      errors.push({
        field: 'justification',
        message: `La justificación debe tener al menos ${MIN_JUSTIFICATION} caracteres`,
      });
    }
  }

  // ── Rango de hora ────────────────────────────────────────────────────────
  const wantsRange = NEEDS_TIME_RANGE.has(status);
  if (wantsRange) {
    if (!input.startsAt || !input.endsAt) {
      errors.push({ field: 'startsAt', message: 'Hay que indicar la hora de inicio y de fin' });
    } else {
      const start = new Date(input.startsAt);
      const end = new Date(input.endsAt);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        errors.push({ field: 'startsAt', message: 'Fechas inválidas' });
      } else if (end.getTime() <= start.getTime()) {
        errors.push({ field: 'endsAt', message: 'La hora de fin debe ser posterior a la de inicio' });
      } else if (localDateString(start, tz) !== localDateString(end, tz)) {
        errors.push({ field: 'endsAt', message: 'El rango debe caer en un solo día' });
      }
    }
  } else if (input.startsAt || input.endsAt) {
    errors.push({ field: 'startsAt', message: `${status} no admite rango de hora` });
  }

  // ── Participantes ────────────────────────────────────────────────────────
  const participants = input.participantIds;
  if (participants && participants.length > 0) {
    if (status !== 'IN_MEETING_INTERNAL') {
      errors.push({
        field: 'participantIds',
        message: 'Solo se pueden indicar participantes en una reunión interna',
      });
    } else if (new Set(participants).size !== participants.length) {
      errors.push({ field: 'participantIds', message: 'Hay participantes repetidos' });
    }
  }

  return errors;
}
```

La validación de que el host no se incluya a sí mismo y de que ningún participante esté ausente necesita datos de la base, así que vive en el endpoint (Task 16), no acá.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- status-rules`
Expected: PASS, 22 pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/lib/status-rules.ts src/lib/status-rules.test.ts
git commit -m "feat: add day-status rules and PATCH validation"
```

---

### Task 7: Validación de ausencias

`PERMISO` se captura como una fecha más hora de inicio y fin y tiene que empezar y terminar el mismo día. `VACACIONES` e `INCAPACIDAD` cubren días completos. Las tres exigen que no haya solape con otra ausencia del mismo usuario.

**Files:**
- Create: `src/lib/absence-validation.ts`
- Test: `src/lib/absence-validation.test.ts`

**Interfaces:**
- Consumes: `localDateString`, `MIN_JUSTIFICATION`, `AbsenceType`, `ValidationError`
- Produces:
  - `AbsenceWindow` = `{ type: AbsenceType; startAt: Date; endAt: Date; justification: string | null }`
  - `validateAbsenceInput(input: AbsenceInput, tz: string): ValidationError[]`
  - `findOverlap(candidate: {startAt: Date; endAt: Date}, existing: AbsenceWindow[]): AbsenceWindow | null`
  - `NEEDS_ABSENCE_JUSTIFICATION: Set<AbsenceType>`

- [ ] **Step 1: Escribir las pruebas que fallan**

Archivo `src/lib/absence-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateAbsenceInput, findOverlap } from './absence-validation';
import { DEFAULT_TZ } from './local-date';

const TZ = DEFAULT_TZ;
const fields = (i: any) => validateAbsenceInput(i, TZ).map(e => e.field);
const JUST = 'cita médica en la CCSS';

describe('validateAbsenceInput — tipo', () => {
  it('rechaza un tipo que no existe', () => {
    expect(fields({ type: 'FERIADO', startAt: '2026-09-14T06:00:00Z', endAt: '2026-09-15T05:59:59Z' }))
      .toContain('type');
  });
});

describe('validateAbsenceInput — rango', () => {
  it('exige fin posterior al inicio', () => {
    expect(fields({
      type: 'VACACIONES',
      startAt: '2026-09-20T06:00:00Z',
      endAt: '2026-09-14T06:00:00Z',
    })).toContain('endAt');
  });

  it('acepta vacaciones de varios días', () => {
    expect(validateAbsenceInput({
      type: 'VACACIONES',
      startAt: '2026-11-03T06:00:00Z',
      endAt: '2026-11-15T05:59:59.999Z',
    }, TZ)).toEqual([]);
  });
});

describe('validateAbsenceInput — PERMISO', () => {
  it('acepta un permiso de unas horas del mismo día', () => {
    expect(validateAbsenceInput({
      type: 'PERMISO',
      startAt: '2026-09-14T20:00:00Z', // 14:00 local
      endAt: '2026-09-14T23:00:00Z',   // 17:00 local
      justification: JUST,
    }, TZ)).toEqual([]);
  });

  it('rechaza un permiso que cruza de día local', () => {
    expect(fields({
      type: 'PERMISO',
      startAt: '2026-09-14T20:00:00Z',
      endAt: '2026-09-15T20:00:00Z',
      justification: JUST,
    })).toContain('endAt');
  });

  it('exige justificación', () => {
    expect(fields({
      type: 'PERMISO',
      startAt: '2026-09-14T20:00:00Z',
      endAt: '2026-09-14T23:00:00Z',
    })).toContain('justification');
  });
});

describe('validateAbsenceInput — justificación', () => {
  it('INCAPACIDAD la exige', () => {
    expect(fields({
      type: 'INCAPACIDAD',
      startAt: '2026-09-14T06:00:00Z',
      endAt: '2026-09-19T05:59:59Z',
    })).toContain('justification');
  });

  it('VACACIONES no la exige', () => {
    expect(validateAbsenceInput({
      type: 'VACACIONES',
      startAt: '2026-11-03T06:00:00Z',
      endAt: '2026-11-15T05:59:59.999Z',
    }, TZ)).toEqual([]);
  });

  it('rechaza justificación corta en INCAPACIDAD', () => {
    expect(fields({
      type: 'INCAPACIDAD',
      startAt: '2026-09-14T06:00:00Z',
      endAt: '2026-09-19T05:59:59Z',
      justification: 'gripe',
    })).toContain('justification');
  });
});

describe('findOverlap', () => {
  const existing = [{
    type: 'VACACIONES' as const,
    startAt: new Date('2026-11-03T06:00:00Z'),
    endAt: new Date('2026-11-15T05:59:59.999Z'),
    justification: null,
  }];

  it('detecta solape parcial por el inicio', () => {
    expect(findOverlap({
      startAt: new Date('2026-11-01T06:00:00Z'),
      endAt: new Date('2026-11-05T05:59:59Z'),
    }, existing)).toBe(existing[0]);
  });

  it('detecta contención completa', () => {
    expect(findOverlap({
      startAt: new Date('2026-11-05T06:00:00Z'),
      endAt: new Date('2026-11-07T05:59:59Z'),
    }, existing)).toBe(existing[0]);
  });

  it('null cuando termina justo antes de que empiece la otra', () => {
    expect(findOverlap({
      startAt: new Date('2026-11-01T06:00:00Z'),
      endAt: new Date('2026-11-03T05:59:59.999Z'),
    }, existing)).toBeNull();
  });

  it('null cuando empieza después', () => {
    expect(findOverlap({
      startAt: new Date('2026-11-16T06:00:00Z'),
      endAt: new Date('2026-11-20T05:59:59Z'),
    }, existing)).toBeNull();
  });

  it('null con lista vacía', () => {
    expect(findOverlap({
      startAt: new Date('2026-11-01T06:00:00Z'),
      endAt: new Date('2026-11-05T06:00:00Z'),
    }, [])).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- absence-validation`
Expected: FAIL, no resuelve el import.

- [ ] **Step 3: Implementar**

Archivo `src/lib/absence-validation.ts`:

```ts
import { localDateString } from './local-date';
import { MIN_JUSTIFICATION, type AbsenceType, type ValidationError } from './status-rules';

export const ABSENCE_TYPES: AbsenceType[] = ['PERMISO', 'VACACIONES', 'INCAPACIDAD'];

export const NEEDS_ABSENCE_JUSTIFICATION = new Set<AbsenceType>([
  'PERMISO', 'INCAPACIDAD',
]);

/** Ausencias cuya justificación solo ven el dueño, su jefe y office.manage. */
export const RESTRICTED_ABSENCES = new Set<AbsenceType>([
  'PERMISO', 'INCAPACIDAD',
]);

export interface AbsenceWindow {
  type: AbsenceType;
  startAt: Date;
  endAt: Date;
  justification: string | null;
}

export interface AbsenceInput {
  type: string;
  startAt: string;
  endAt: string;
  justification?: string;
}

export function isAbsenceType(v: string): v is AbsenceType {
  return (ABSENCE_TYPES as string[]).includes(v);
}

export function validateAbsenceInput(input: AbsenceInput, tz: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!isAbsenceType(input.type)) {
    return [{ field: 'type', message: `Tipo de ausencia inválido: ${input.type}` }];
  }
  const type = input.type;

  const startAt = new Date(input.startAt);
  const endAt = new Date(input.endAt);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return [{ field: 'startAt', message: 'Fechas inválidas' }];
  }
  if (endAt.getTime() <= startAt.getTime()) {
    errors.push({ field: 'endAt', message: 'El fin debe ser posterior al inicio' });
  }

  // Un permiso es de unas horas dentro de un día, no de varios días.
  if (type === 'PERMISO' && localDateString(startAt, tz) !== localDateString(endAt, tz)) {
    errors.push({ field: 'endAt', message: 'Un permiso debe empezar y terminar el mismo día' });
  }

  const justification = (input.justification ?? '').trim();
  if (NEEDS_ABSENCE_JUSTIFICATION.has(type) && justification.length < MIN_JUSTIFICATION) {
    errors.push({
      field: 'justification',
      message: `La justificación debe tener al menos ${MIN_JUSTIFICATION} caracteres`,
    });
  }

  return errors;
}

/**
 * Primera ausencia que se solapa con el candidato, o null.
 * Los extremos se tratan como cerrados, así que terminar en el instante exacto
 * en que empieza la otra NO cuenta como solape: la anterior cierra en
 * 05:59:59.999Z y la siguiente abre en 06:00:00.000Z.
 */
export function findOverlap(
  candidate: { startAt: Date; endAt: Date },
  existing: AbsenceWindow[],
): AbsenceWindow | null {
  for (const a of existing) {
    if (candidate.startAt <= a.endAt && candidate.endAt >= a.startAt) return a;
  }
  return null;
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- absence-validation`
Expected: PASS, 14 pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/lib/absence-validation.ts src/lib/absence-validation.test.ts
git commit -m "feat: add absence validation and overlap detection"
```

---

### Task 8: Resolver de feriados

Un feriado aplica según el país del colaborador. Si movió ese feriado con un override, **ese día trabaja** y el feriado le cae en `newDate`. Es la parte del diseño que más fácil se implementa al revés.

**Files:**
- Create: `src/lib/holiday-resolver.ts`
- Test: `src/lib/holiday-resolver.test.ts`

**Interfaces:**
- Consumes: `localDateString`, `sameLocalMonth`, `MIN_JUSTIFICATION`, `ValidationError`
- Produces:
  - `HolidayRow` = `{ id: string; date: Date; country: string; name: string }`
  - `OverrideRow` = `{ holidayId: string; newDate: Date }`
  - `isHolidayEffective(args): boolean`
  - `movableHolidays(holidays: HolidayRow[], overrides: OverrideRow[], country: string): HolidayRow[]`
  - `validateOverrideInput(holidayDate: Date, newDate: Date, justification: string, tz: string): ValidationError[]`

- [ ] **Step 1: Escribir las pruebas que fallan**

Archivo `src/lib/holiday-resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  isHolidayEffective,
  movableHolidays,
  validateOverrideInput,
} from './holiday-resolver';
import { DEFAULT_TZ } from './local-date';

const TZ = DEFAULT_TZ;

// 15 de septiembre, Independencia de Costa Rica
const indep = { id: 'h1', date: new Date('2026-09-15T00:00:00Z'), country: 'CR', name: 'Independencia' };
// 1 de diciembre, Abolición del Ejército
const abol  = { id: 'h2', date: new Date('2026-12-01T00:00:00Z'), country: 'CR', name: 'Abolición' };
// 14 de septiembre, feriado de Nicaragua
const niBattle = { id: 'h3', date: new Date('2026-09-14T00:00:00Z'), country: 'NI', name: 'San Jacinto' };

const noon = (iso: string) => new Date(iso);

describe('isHolidayEffective', () => {
  it('aplica el feriado del país del colaborador', () => {
    expect(isHolidayEffective({
      now: noon('2026-09-15T18:00:00Z'),
      country: 'CR',
      holidays: [indep],
      overrides: [],
      tz: TZ,
    })).toBe(true);
  });

  it('no aplica el feriado de otro país', () => {
    expect(isHolidayEffective({
      now: noon('2026-09-14T18:00:00Z'),
      country: 'CR',
      holidays: [niBattle],
      overrides: [],
      tz: TZ,
    })).toBe(false);
  });

  it('no aplica en un día que no es feriado', () => {
    expect(isHolidayEffective({
      now: noon('2026-09-16T18:00:00Z'),
      country: 'CR',
      holidays: [indep],
      overrides: [],
      tz: TZ,
    })).toBe(false);
  });

  it('con override, la fecha original deja de ser feriado', () => {
    expect(isHolidayEffective({
      now: noon('2026-09-15T18:00:00Z'),
      country: 'CR',
      holidays: [indep],
      overrides: [{ holidayId: 'h1', newDate: new Date('2026-09-25T00:00:00Z') }],
      tz: TZ,
    })).toBe(false);
  });

  it('con override, la fecha nueva sí es feriado', () => {
    expect(isHolidayEffective({
      now: noon('2026-09-25T18:00:00Z'),
      country: 'CR',
      holidays: [indep],
      overrides: [{ holidayId: 'h1', newDate: new Date('2026-09-25T00:00:00Z') }],
      tz: TZ,
    })).toBe(true);
  });

  it('un override no afecta a los otros feriados', () => {
    expect(isHolidayEffective({
      now: noon('2026-12-01T18:00:00Z'),
      country: 'CR',
      holidays: [indep, abol],
      overrides: [{ holidayId: 'h1', newDate: new Date('2026-09-25T00:00:00Z') }],
      tz: TZ,
    })).toBe(true);
  });

  it('usa el día local y no el de UTC a las 23:00 locales', () => {
    // 2026-09-16T05:00:00Z son las 23:00 del 15 en Costa Rica: sigue siendo feriado
    expect(isHolidayEffective({
      now: noon('2026-09-16T05:00:00Z'),
      country: 'CR',
      holidays: [indep],
      overrides: [],
      tz: TZ,
    })).toBe(true);
  });
});

describe('movableHolidays', () => {
  it('lista los feriados del país que no se movieron', () => {
    const r = movableHolidays([indep, abol, niBattle], [], 'CR');
    expect(r.map(h => h.id)).toEqual(['h1', 'h2']);
  });

  it('excluye el que ya se movió', () => {
    const r = movableHolidays([indep, abol], [{ holidayId: 'h1', newDate: new Date() }], 'CR');
    expect(r.map(h => h.id)).toEqual(['h2']);
  });
});

describe('validateOverrideInput', () => {
  const JUST = 'tomo el feriado el viernes siguiente';

  it('acepta otra fecha del mismo mes', () => {
    expect(validateOverrideInput(
      indep.date, new Date('2026-09-25T00:00:00Z'), JUST, TZ,
    )).toEqual([]);
  });

  it('rechaza una fecha de otro mes', () => {
    expect(validateOverrideInput(
      indep.date, new Date('2026-10-02T00:00:00Z'), JUST, TZ,
    ).map(e => e.field)).toContain('newDate');
  });

  it('rechaza el mismo mes de otro año', () => {
    expect(validateOverrideInput(
      indep.date, new Date('2027-09-25T00:00:00Z'), JUST, TZ,
    ).map(e => e.field)).toContain('newDate');
  });

  it('exige justificación', () => {
    expect(validateOverrideInput(
      indep.date, new Date('2026-09-25T00:00:00Z'), 'x', TZ,
    ).map(e => e.field)).toContain('justification');
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- holiday-resolver`
Expected: FAIL, no resuelve el import.

- [ ] **Step 3: Implementar**

Archivo `src/lib/holiday-resolver.ts`:

```ts
import { localDateString, sameLocalMonth } from './local-date';
import { MIN_JUSTIFICATION, type ValidationError } from './status-rules';

export interface HolidayRow {
  id: string;
  date: Date;
  country: string;
  name: string;
}

export interface OverrideRow {
  holidayId: string;
  newDate: Date;
}

export interface HolidayEffectiveArgs {
  now: Date;
  country: string;
  holidays: HolidayRow[];
  overrides: OverrideRow[];
  tz: string;
}

/**
 * ¿Hoy es feriado para este colaborador?
 *
 * Dos caminos dan true:
 *  a. movió un feriado y hoy es la fecha nueva
 *  b. hoy hay un feriado de su país que NO movió
 *
 * El punto (b) es lo que hace funcionar el override: si lo movió, la fecha
 * original vuelve a ser día de trabajo.
 *
 * Las fechas de Holiday y HolidayOverride son columnas DATE sin hora ni zona,
 * así que se comparan como texto en UTC. "Hoy", en cambio, se calcula en la
 * zona de la operación.
 */
export function isHolidayEffective(args: HolidayEffectiveArgs): boolean {
  const { now, country, holidays, overrides, tz } = args;
  const today = localDateString(now, tz);

  const movedIds = new Set(overrides.map(o => o.holidayId));

  for (const o of overrides) {
    if (dateOnly(o.newDate) === today) return true;
  }

  for (const h of holidays) {
    if (h.country !== country) continue;
    if (movedIds.has(h.id)) continue;
    if (dateOnly(h.date) === today) return true;
  }

  return false;
}

/** Feriados del país que el colaborador todavía puede mover. */
export function movableHolidays(
  holidays: HolidayRow[],
  overrides: OverrideRow[],
  country: string,
): HolidayRow[] {
  const movedIds = new Set(overrides.map(o => o.holidayId));
  return holidays.filter(h => h.country === country && !movedIds.has(h.id));
}

export function validateOverrideInput(
  holidayDate: Date,
  newDate: Date,
  justification: string,
  tz: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (Number.isNaN(newDate.getTime())) {
    return [{ field: 'newDate', message: 'Fecha inválida' }];
  }
  if (!sameLocalMonth(holidayDate, newDate, tz)) {
    errors.push({
      field: 'newDate',
      message: 'El feriado solo se puede mover a otra fecha del mismo mes',
    });
  }
  if ((justification ?? '').trim().length < MIN_JUSTIFICATION) {
    errors.push({
      field: 'justification',
      message: `La justificación debe tener al menos ${MIN_JUSTIFICATION} caracteres`,
    });
  }

  return errors;
}

/** Parte de fecha de una columna DATE, que Prisma entrega a medianoche UTC. */
function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
```

`sameLocalMonth` compara año y mes, así que el caso de "mismo mes, otro año" ya queda cubierto sin código extra.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- holiday-resolver`
Expected: PASS, 13 pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/lib/holiday-resolver.ts src/lib/holiday-resolver.test.ts
git commit -m "feat: add holiday resolver with per-user override"
```

---

### Task 9: Resolver de estado visible

La precedencia del diseño: ausencia gana sobre feriado, y feriado gana sobre el estado del día. Una incapacidad que cae en feriado se lee como incapacidad.

**Files:**
- Create: `src/lib/state-resolver.ts`
- Test: `src/lib/state-resolver.test.ts`

**Interfaces:**
- Consumes: `OfficeStatus`, `ResolvedStatus` de la Task 6, `AbsenceWindow` de la Task 7
- Produces:
  - `ResolveInput` = `{ presenceStatus: OfficeStatus; presenceJustification: string | null; absences: AbsenceWindow[]; isHolidayToday: boolean; now: Date }`
  - `Resolved` = `{ status: ResolvedStatus; justification: string | null; isAbsent: boolean; absenceEndsAt: Date | null }`
  - `resolveStatus(input: ResolveInput): Resolved`
  - `activeAbsence(absences: AbsenceWindow[], now: Date): AbsenceWindow | null`

- [ ] **Step 1: Escribir las pruebas que fallan**

Archivo `src/lib/state-resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveStatus, activeAbsence } from './state-resolver';
import type { AbsenceWindow } from './absence-validation';

const NOW = new Date('2026-09-14T18:00:00Z'); // mediodía local

const vacaciones: AbsenceWindow = {
  type: 'VACACIONES',
  startAt: new Date('2026-09-10T06:00:00Z'),
  endAt: new Date('2026-09-20T05:59:59.999Z'),
  justification: null,
};

const incapacidad: AbsenceWindow = {
  type: 'INCAPACIDAD',
  startAt: new Date('2026-09-14T06:00:00Z'),
  endAt: new Date('2026-09-19T05:59:59.999Z'),
  justification: 'Boleta CCSS 4477-2026',
};

const base = {
  presenceStatus: 'AVAILABLE' as const,
  presenceJustification: null,
  absences: [],
  isHolidayToday: false,
  now: NOW,
};

describe('resolveStatus — precedencia', () => {
  it('sin ausencia ni feriado, devuelve el estado del día', () => {
    const r = resolveStatus({ ...base, presenceStatus: 'FOCUS', presenceJustification: 'cerrando reporte' });
    expect(r.status).toBe('FOCUS');
    expect(r.justification).toBe('cerrando reporte');
    expect(r.isAbsent).toBe(false);
  });

  it('la ausencia activa gana sobre el estado del día', () => {
    const r = resolveStatus({ ...base, presenceStatus: 'AVAILABLE', absences: [vacaciones] });
    expect(r.status).toBe('VACACIONES');
    expect(r.isAbsent).toBe(true);
  });

  it('el feriado gana sobre el estado del día', () => {
    const r = resolveStatus({ ...base, presenceStatus: 'AVAILABLE', isHolidayToday: true });
    expect(r.status).toBe('FERIADO');
    expect(r.isAbsent).toBe(true);
  });

  it('la ausencia gana sobre el feriado cuando se solapan', () => {
    const r = resolveStatus({ ...base, absences: [incapacidad], isHolidayToday: true });
    expect(r.status).toBe('INCAPACIDAD');
  });

  it('expone la justificación de la ausencia, no la del estado del día', () => {
    const r = resolveStatus({
      ...base,
      presenceStatus: 'FOCUS',
      presenceJustification: 'algo del día',
      absences: [incapacidad],
    });
    expect(r.justification).toBe('Boleta CCSS 4477-2026');
  });

  it('expone cuándo vuelve', () => {
    const r = resolveStatus({ ...base, absences: [vacaciones] });
    expect(r.absenceEndsAt?.toISOString()).toBe('2026-09-20T05:59:59.999Z');
  });

  it('el feriado no tiene fecha de regreso', () => {
    const r = resolveStatus({ ...base, isHolidayToday: true });
    expect(r.absenceEndsAt).toBeNull();
  });
});

describe('activeAbsence', () => {
  it('ignora una ausencia que ya venció', () => {
    const vencida: AbsenceWindow = {
      ...vacaciones,
      startAt: new Date('2026-08-01T06:00:00Z'),
      endAt: new Date('2026-08-10T05:59:59Z'),
    };
    expect(activeAbsence([vencida], NOW)).toBeNull();
  });

  it('ignora una ausencia futura', () => {
    const futura: AbsenceWindow = {
      ...vacaciones,
      startAt: new Date('2026-11-03T06:00:00Z'),
      endAt: new Date('2026-11-15T05:59:59Z'),
    };
    expect(activeAbsence([futura], NOW)).toBeNull();
  });

  it('incluye los extremos', () => {
    expect(activeAbsence([vacaciones], vacaciones.startAt)).toBe(vacaciones);
    expect(activeAbsence([vacaciones], vacaciones.endAt)).toBe(vacaciones);
  });

  it('con varias activas devuelve la primera', () => {
    expect(activeAbsence([vacaciones, incapacidad], NOW)).toBe(vacaciones);
  });

  it('null con lista vacía', () => {
    expect(activeAbsence([], NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- state-resolver`
Expected: FAIL, no resuelve el import.

- [ ] **Step 3: Implementar**

Archivo `src/lib/state-resolver.ts`:

```ts
import type { AbsenceWindow } from './absence-validation';
import type { OfficeStatus, ResolvedStatus } from './status-rules';

export interface ResolveInput {
  presenceStatus: OfficeStatus;
  presenceJustification: string | null;
  absences: AbsenceWindow[];
  isHolidayToday: boolean;
  now: Date;
}

export interface Resolved {
  status: ResolvedStatus;
  justification: string | null;
  isAbsent: boolean;
  absenceEndsAt: Date | null;
}

/** Primera ausencia que cubre el instante dado. Extremos incluidos. */
export function activeAbsence(absences: AbsenceWindow[], now: Date): AbsenceWindow | null {
  for (const a of absences) {
    if (now >= a.startAt && now <= a.endAt) return a;
  }
  return null;
}

/**
 * Estado que ve la oficina. Precedencia: ausencia > feriado > estado del día.
 *
 * Las ausencias y los feriados nunca se escriben en PresenceStatus.status: se
 * calculan acá. Por eso el cron de timeman puede seguir moviendo el estado del
 * día sin pisar una ausencia.
 */
export function resolveStatus(input: ResolveInput): Resolved {
  const absence = activeAbsence(input.absences, input.now);
  if (absence) {
    return {
      status: absence.type,
      justification: absence.justification,
      isAbsent: true,
      absenceEndsAt: absence.endAt,
    };
  }

  if (input.isHolidayToday) {
    return {
      status: 'FERIADO',
      justification: null,
      isAbsent: true,
      absenceEndsAt: null,
    };
  }

  return {
    status: input.presenceStatus,
    justification: input.presenceJustification,
    isAbsent: false,
    absenceEndsAt: null,
  };
}
```

La justificación del override de feriado no viaja acá: el resolver solo recibe `isHolidayToday`. El texto del override se agrega en el snapshot (Task 17), que es quien tiene la fila a mano.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- state-resolver`
Expected: PASS, 12 pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/lib/state-resolver.ts src/lib/state-resolver.test.ts
git commit -m "feat: add visible-state resolver with absence/holiday precedence"
```

---

### Task 10: Visibilidad de justificaciones

Permiso e incapacidad llevan motivos médicos y personales. La regla se decide acá y el snapshot la aplica omitiendo el campo, para que el texto no viaje al cliente sin permiso.

**Files:**
- Create: `src/lib/justification-visibility.ts`
- Test: `src/lib/justification-visibility.test.ts`

**Interfaces:**
- Consumes: `PUBLIC_JUSTIFICATION`, `ResolvedStatus` de la Task 6
- Produces:
  - `Viewer` = `{ userId: string; hasManage: boolean; managedUserIds: Set<string> }`
  - `canSeeJustification(viewer: Viewer, targetUserId: string, resolved: ResolvedStatus): boolean`

- [ ] **Step 1: Escribir las pruebas que fallan**

Archivo `src/lib/justification-visibility.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canSeeJustification, type Viewer } from './justification-visibility';

const ana: Viewer   = { userId: 'ana',   hasManage: false, managedUserIds: new Set() };
const jefe: Viewer  = { userId: 'jefe',  hasManage: false, managedUserIds: new Set(['ana']) };
const rrhh: Viewer  = { userId: 'rrhh',  hasManage: true,  managedUserIds: new Set() };
const ajeno: Viewer = { userId: 'ajeno', hasManage: false, managedUserIds: new Set() };

describe('canSeeJustification — estados públicos', () => {
  for (const s of ['FOCUS', 'IN_MEETING_INTERNAL', 'IN_MEETING_EXTERNAL', 'BRB', 'FERIADO'] as const) {
    it(`cualquiera ve la de ${s}`, () => {
      expect(canSeeJustification(ajeno, 'ana', s)).toBe(true);
    });
  }
});

describe('canSeeJustification — estados restringidos', () => {
  for (const s of ['PERMISO', 'INCAPACIDAD'] as const) {
    it(`${s}: el dueño sí`, () => {
      expect(canSeeJustification(ana, 'ana', s)).toBe(true);
    });

    it(`${s}: el jefe directo sí`, () => {
      expect(canSeeJustification(jefe, 'ana', s)).toBe(true);
    });

    it(`${s}: office.manage sí`, () => {
      expect(canSeeJustification(rrhh, 'ana', s)).toBe(true);
    });

    it(`${s}: un tercero no`, () => {
      expect(canSeeJustification(ajeno, 'ana', s)).toBe(false);
    });

    it(`${s}: el jefe de OTRA persona no`, () => {
      expect(canSeeJustification(jefe, 'beto', s)).toBe(false);
    });
  }
});

describe('canSeeJustification — estados sin justificación', () => {
  it('AVAILABLE no tiene nada que mostrar', () => {
    expect(canSeeJustification(ajeno, 'ana', 'AVAILABLE')).toBe(false);
  });

  it('VACACIONES no lleva justificación', () => {
    expect(canSeeJustification(ajeno, 'ana', 'VACACIONES')).toBe(false);
  });

  it('el dueño tampoco ve una que no existe', () => {
    expect(canSeeJustification(ana, 'ana', 'VACACIONES')).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- justification-visibility`
Expected: FAIL, no resuelve el import.

- [ ] **Step 3: Implementar**

Archivo `src/lib/justification-visibility.ts`:

```ts
import { PUBLIC_JUSTIFICATION, type ResolvedStatus } from './status-rules';

/** Estados restringidos: solo el dueño, su jefe directo y office.manage. */
const RESTRICTED: Set<ResolvedStatus> = new Set(['PERMISO', 'INCAPACIDAD']);

export interface Viewer {
  userId: string;
  hasManage: boolean;
  /** Usuarios de los que este viewer es jefe directo. */
  managedUserIds: Set<string>;
}

export function canSeeJustification(
  viewer: Viewer,
  targetUserId: string,
  resolved: ResolvedStatus,
): boolean {
  if (PUBLIC_JUSTIFICATION.has(resolved)) return true;
  if (!RESTRICTED.has(resolved)) return false; // el estado no lleva justificación

  if (viewer.userId === targetUserId) return true;
  if (viewer.hasManage) return true;
  return viewer.managedUserIds.has(targetUserId);
}
```

El orden importa: primero se descarta lo público, después se descarta lo que simplemente no tiene justificación (`AVAILABLE`, `LUNCH`, `VACACIONES`, `OFFLINE`), y solo al final se evalúa quién es el viewer. Así el dueño de unas vacaciones no recibe `true` para un campo que no existe.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- justification-visibility`
Expected: PASS, 18 pruebas.

- [ ] **Step 5: Commit**

```bash
git add src/lib/justification-visibility.ts src/lib/justification-visibility.test.ts
git commit -m "feat: add justification visibility rules"
```

---

### Task 11: Máquina de estados de la invitación

**Files:**
- Create: `src/lib/meeting-invites.ts`
- Test: `src/lib/meeting-invites.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `InviteState` = `'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED'`
  - `INVITE_TTL_MS: number` = `900000`
  - `isExpired(createdAt: Date, now: Date): boolean`
  - `InviteAction` = `'accept' | 'decline' | 'cancel'`
  - `nextInviteState(current: InviteState, action: InviteAction, createdAt: Date, now: Date): { state: InviteState } | { error: string }`

- [ ] **Step 1: Escribir las pruebas que fallan**

Archivo `src/lib/meeting-invites.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextInviteState, isExpired, INVITE_TTL_MS } from './meeting-invites';

const created = new Date('2026-09-14T18:00:00Z');
const soon    = new Date(created.getTime() + 60_000);
const late    = new Date(created.getTime() + INVITE_TTL_MS + 1);

describe('isExpired', () => {
  it('false dentro de la ventana', () => {
    expect(isExpired(created, soon)).toBe(false);
  });

  it('false exactamente en el límite', () => {
    expect(isExpired(created, new Date(created.getTime() + INVITE_TTL_MS))).toBe(false);
  });

  it('true pasado el límite', () => {
    expect(isExpired(created, late)).toBe(true);
  });
});

describe('nextInviteState', () => {
  it('aceptar una pendiente a tiempo', () => {
    expect(nextInviteState('PENDING', 'accept', created, soon)).toEqual({ state: 'ACCEPTED' });
  });

  it('rechazar una pendiente', () => {
    expect(nextInviteState('PENDING', 'decline', created, soon)).toEqual({ state: 'DECLINED' });
  });

  it('cancelar una pendiente', () => {
    expect(nextInviteState('PENDING', 'cancel', created, soon)).toEqual({ state: 'CANCELLED' });
  });

  it('aceptar una vencida la marca EXPIRED y da error', () => {
    const r = nextInviteState('PENDING', 'accept', created, late);
    expect(r).toEqual({ error: 'expired' });
  });

  it('rechazar una vencida también falla', () => {
    expect(nextInviteState('PENDING', 'decline', created, late)).toEqual({ error: 'expired' });
  });

  it('cancelar una vencida sí se permite: es limpieza del host', () => {
    expect(nextInviteState('PENDING', 'cancel', created, late)).toEqual({ state: 'CANCELLED' });
  });

  it('no se puede aceptar dos veces', () => {
    expect(nextInviteState('ACCEPTED', 'accept', created, soon)).toEqual({ error: 'not_pending' });
  });

  it('no se puede aceptar una rechazada', () => {
    expect(nextInviteState('DECLINED', 'accept', created, soon)).toEqual({ error: 'not_pending' });
  });

  it('el host sí puede cancelar una aceptada: termina la reunión', () => {
    expect(nextInviteState('ACCEPTED', 'cancel', created, soon)).toEqual({ state: 'CANCELLED' });
  });

  it('no se puede cancelar una ya cancelada', () => {
    expect(nextInviteState('CANCELLED', 'cancel', created, soon)).toEqual({ error: 'not_pending' });
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npm test -- meeting-invites`
Expected: FAIL, no resuelve el import.

- [ ] **Step 3: Implementar**

Archivo `src/lib/meeting-invites.ts`:

```ts
export type InviteState = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
export type InviteAction = 'accept' | 'decline' | 'cancel';

export const INVITE_TTL_MS = 15 * 60 * 1000;

export function isExpired(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > INVITE_TTL_MS;
}

export type InviteTransition = { state: InviteState } | { error: string };

/**
 * Transición válida de una invitación.
 *
 * `cancel` es la acción del host, no del invitado, así que se permite sobre una
 * invitación ACCEPTED (el host cambió de estado y la reunión terminó) y también
 * sobre una PENDING ya vencida (limpieza). `accept` y `decline` son del invitado
 * y solo aplican a una PENDING dentro de la ventana.
 */
export function nextInviteState(
  current: InviteState,
  action: InviteAction,
  createdAt: Date,
  now: Date,
): InviteTransition {
  if (action === 'cancel') {
    if (current === 'PENDING' || current === 'ACCEPTED') return { state: 'CANCELLED' };
    return { error: 'not_pending' };
  }

  if (current !== 'PENDING') return { error: 'not_pending' };
  if (isExpired(createdAt, now)) return { error: 'expired' };

  return { state: action === 'accept' ? 'ACCEPTED' : 'DECLINED' };
}
```

El vencimiento se evalúa al leer, no con un cron. Una invitación pasa a `EXPIRED` en la base cuando el servicio la barre (Task 15); mientras tanto, `nextInviteState` ya se niega a aceptarla.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npm test -- meeting-invites`
Expected: PASS, 13 pruebas.

- [ ] **Step 5: Correr toda la suite de la fase**

Run: `npm test`
Expected: PASS, 7 archivos, 103 pruebas.

- [ ] **Step 6: Commit**

```bash
git add src/lib/meeting-invites.ts src/lib/meeting-invites.test.ts
git commit -m "feat: add meeting invite state machine"
```

---

## Fase 2 — Servicios y API

Los servicios son capa fina: leen y escriben, y delegan toda decisión a `src/lib/`. La verificación de esta fase es con `curl` contra el servidor de desarrollo, porque probar Prisma y Redis con mocks cuesta más de lo que atrapa.

**Arranque del entorno de desarrollo, una vez por sesión de trabajo:**

```bash
# Terminal 1 — core
cd vla-system && docker compose up -d && npm run dev -w @vla/api

# Terminal 2 — plugin, recompila e instala
cd vla-plugin-office && npm run dev
```

**El plugin NO tiene recarga en caliente.** El core monta los plugins una sola vez
en `onModuleInit()`: no hay watcher que recargue `dist/index.js`. O sea que
`npm run dev` en el plugin compila e instala en
`apps/api/storage/plugins/office/`, pero el proceso del API sigue ejecutando el
código viejo en memoria.

Así que el ciclo de cada tarea de esta fase es:

```bash
cd vla-plugin-office && npm run dev     # compila e instala
# reiniciar el API para que cargue el dist nuevo:
pkill -9 -f "nest start"
cd vla-system && nohup npm run dev -w @vla/api > /tmp/api.log 2>&1 &
# esperar a que levante (tarda varios minutos la primera compilacion):
until curl -s -o /dev/null -m 3 localhost:3001/api/v1/auth/me; do sleep 8; done
```

**Si tus endpoints nuevos dan 404, es casi siempre esto y no un error del código.**

**La autenticación es por cookie HttpOnly, no por bearer token.** El login
responde solo `{"user":{...}}` y manda la sesión en `Set-Cookie: vla_token=...`.
No existe ningún `accessToken` en el cuerpo, así que `-H "Authorization: Bearer"`
no autentica nada. Se usa un frasco de cookies:

```bash
J=/tmp/vla-cookies.txt
curl -s -c $J -X POST localhost:3001/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"josue@vla.com","password":"admin123"}' -o /dev/null
curl -s -b $J -o /dev/null -w 'login ok: %{http_code}\n' localhost:3001/api/v1/auth/me
```

De ahí en adelante, **toda** llamada autenticada lleva `-b $J`. Para probar con
otro usuario, otro frasco: `-c /tmp/vla-cookies-otro.txt`.

### Task 12: Servicio y endpoints de ausencias

**Files:**
- Create: `src/services/absence.service.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `validateAbsenceInput`, `findOverlap`, `AbsenceWindow` (Task 7), `localDayStart`, `localDayEnd`, `zonedTimeToUtc` (Task 5)
- Produces:
  - `AbsenceService.create(userId, input, createdBy, tz): Promise<{ record } | { errors } | { conflict }>`
  - `AbsenceService.listForUser(userId, from?, to?): Promise<AbsenceWindow[]>`
  - `AbsenceService.activeByUserId(now): Promise<Map<string, AbsenceWindow>>`
  - `AbsenceService.remove(id, requesterId, canManage): Promise<boolean>`

- [ ] **Step 1: Escribir el servicio**

Archivo `src/services/absence.service.ts`:

```ts
import type { PluginContext } from '@vla/plugin-sdk';
import {
  validateAbsenceInput, findOverlap, isAbsenceType,
  type AbsenceInput, type AbsenceWindow,
} from '../lib/absence-validation';
import type { ValidationError } from '../lib/status-rules';

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; errors: ValidationError[] }
  | { ok: false; conflict: AbsenceWindow };

export class AbsenceService {
  constructor(private readonly ctx: PluginContext) {}

  async create(
    userId: string,
    input: AbsenceInput,
    createdBy: string,
    tz: string,
  ): Promise<CreateResult> {
    const errors = validateAbsenceInput(input, tz);
    if (errors.length) return { ok: false, errors };

    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);

    const existing = await this.listForUser(userId);
    const clash = findOverlap({ startAt, endAt }, existing);
    if (clash) return { ok: false, conflict: clash };

    const row = await this.ctx.prisma.absenceRecord.create({
      data: {
        userId,
        type: input.type as any,
        startAt,
        endAt,
        justification: input.justification?.trim() || null,
        createdBy,
      },
    });

    await this.ctx.hooks.doAction('office.absence.created', {
      userId, type: input.type, startAt, endAt,
    });

    return { ok: true, id: (row as any).id };
  }

  async listForUser(userId: string, from?: Date, to?: Date): Promise<AbsenceWindow[]> {
    const where: any = { userId };
    if (from && to) {
      // Cualquier ausencia que toque la ventana pedida.
      where.startAt = { lte: to };
      where.endAt = { gte: from };
    }
    const rows = await this.ctx.prisma.absenceRecord.findMany({
      where,
      orderBy: { startAt: 'asc' },
    });
    return (rows as any[]).map(toWindow);
  }

  /**
   * Ausencia activa de cada usuario en un solo query.
   * El snapshot y el blindaje del cron lo usan para no pegarle a la base una
   * vez por usuario.
   */
  async activeByUserId(now: Date): Promise<Map<string, AbsenceWindow>> {
    const rows = await this.ctx.prisma.absenceRecord.findMany({
      where: { startAt: { lte: now }, endAt: { gte: now } },
      orderBy: { startAt: 'asc' },
    });
    const map = new Map<string, AbsenceWindow>();
    for (const r of rows as any[]) {
      if (!map.has(r.userId)) map.set(r.userId, toWindow(r));
    }
    return map;
  }

  async remove(id: string, requesterId: string, canManage: boolean): Promise<boolean> {
    const row = await this.ctx.prisma.absenceRecord.findUnique({ where: { id } });
    if (!row) return false;
    if (!canManage && (row as any).userId !== requesterId) return false;
    await this.ctx.prisma.absenceRecord.delete({ where: { id } });
    return true;
  }
}

function toWindow(r: any): AbsenceWindow {
  return {
    type: r.type,
    startAt: r.startAt,
    endAt: r.endAt,
    justification: r.justification ?? null,
  };
}
```

- [ ] **Step 2: Declarar el hook nuevo**

En `src/index.ts`, junto a los `ctx.hooks.declareHook(...)` que ya están:

```ts
    ctx.hooks.declareHook('office.absence.created', {
      description: 'Se registró una ausencia (permiso, vacaciones o incapacidad)',
      payload: { userId: 'string', type: 'PERMISO | VACACIONES | INCAPACIDAD', startAt: 'Date', endAt: 'Date' },
    });
```

Y agregarlo a `hooks.emits` en `plugin.json`:

```json
      "office.absence.created",
```

- [ ] **Step 3: Cablear los endpoints**

En `src/index.ts`, después de los endpoints de presencia. `TZ` sale del setting del plugin; si no está configurado cae en `DEFAULT_TZ`.

```ts
    const absences = new AbsenceService(ctx);
    const tz = () => (ctx.plugin.config.TIMEZONE as string) || DEFAULT_TZ;

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

    // Solo las ausencias propias. La rama ?userId= con filtro de visibilidad
    // llega en la Task 14, que es donde existe OrgService para resolver el jefe
    // directo. Acá no hace falta filtrar: cada uno ve sus propias
    // justificaciones siempre.
    ctx.router.get('/absences', ctx.requireAuth(), ctx.requirePermission(PERMS.VIEW), async (req, res) => {
      const requesterId = (req as any).user?.sub;
      if (!requesterId) return res.status(401).json({ message: 'Unauthorized' });

      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      res.json(await absences.listForUser(requesterId, from, to));
    });

    ctx.router.delete('/absences/:id', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), async (req, res) => {
      const requesterId = (req as any).user?.sub;
      if (!requesterId) return res.status(401).json({ message: 'Unauthorized' });
      const canManage = can(req, PERMS.MANAGE);
      const done = await absences.remove(req.params.id, requesterId, canManage);
      if (!done) return res.status(404).json({ message: 'Ausencia no encontrada' });
      res.status(204).end();
    });
```

`PERMS` pasa a tener `CHECKIN: 'office.checkin'` y `MANAGE: 'office.manage'` si todavía no los tiene. Esta tarea **no** referencia `OrgService`: no existe hasta la Task 14, y usarlo acá haría fallar el `tsc` del Step 4.

- [ ] **Step 4: Verificar el tipado**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Probar con curl**

```bash
# Crear vacaciones
curl -s -X POST localhost:3001/api/v1/p/office/absences \
  -b $J -H 'Content-Type: application/json' \
  -d '{"type":"VACACIONES","startAt":"2026-11-03T06:00:00Z","endAt":"2026-11-15T05:59:59.999Z"}'
# Expected: 201 con {"id":"..."}

# Solape: la misma ventana otra vez
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3001/api/v1/p/office/absences \
  -b $J -H 'Content-Type: application/json' \
  -d '{"type":"VACACIONES","startAt":"2026-11-10T06:00:00Z","endAt":"2026-11-20T05:59:59.999Z"}'
# Expected: 409

# Incapacidad sin justificación
curl -s -X POST localhost:3001/api/v1/p/office/absences \
  -b $J -H 'Content-Type: application/json' \
  -d '{"type":"INCAPACIDAD","startAt":"2026-12-01T06:00:00Z","endAt":"2026-12-05T05:59:59Z"}'
# Expected: 400, errors[].field == "justification"

# Listar
curl -s localhost:3001/api/v1/p/office/absences -b $J | jq
```

- [ ] **Step 6: Commit**

```bash
git add src/services/absence.service.ts src/index.ts plugin.json
git commit -m "feat: add absence service and endpoints"
```

---

### Task 13: Servicio y endpoints de feriados

**Files:**
- Create: `src/services/holiday.service.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `isHolidayEffective`, `movableHolidays`, `validateOverrideInput`, `HolidayRow`, `OverrideRow` (Task 8)
- Produces:
  - `HolidayService.list(year?, country?): Promise<HolidayRow[]>`
  - `HolidayService.create(date, name, country): Promise<string>`
  - `HolidayService.remove(id): Promise<boolean>`
  - `HolidayService.setOverride(userId, holidayId, newDate, justification, tz): Promise<{ok:true} | {ok:false; errors} >`
  - `HolidayService.clearOverride(userId, holidayId): Promise<boolean>`
  - `HolidayService.effectiveByUserId(now, countryOf, tz): Promise<Set<string>>`
  - `HolidayService.overrideJustification(userId, now, country, tz): Promise<string | null>`

- [ ] **Step 1: Escribir el servicio**

Archivo `src/services/holiday.service.ts`:

```ts
import type { PluginContext } from '@vla/plugin-sdk';
import {
  isHolidayEffective, movableHolidays, validateOverrideInput,
  type HolidayRow, type OverrideRow,
} from '../lib/holiday-resolver';
import { localDateString } from '../lib/local-date';
import type { ValidationError } from '../lib/status-rules';

export class HolidayService {
  constructor(private readonly ctx: PluginContext) {}

  async list(year?: number, country?: string): Promise<HolidayRow[]> {
    const where: any = {};
    if (country) where.country = country;
    if (year) {
      where.date = {
        gte: new Date(Date.UTC(year, 0, 1)),
        lt: new Date(Date.UTC(year + 1, 0, 1)),
      };
    }
    const rows = await this.ctx.prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
    return rows as any as HolidayRow[];
  }

  async create(date: Date, name: string, country: string): Promise<string> {
    const row = await this.ctx.prisma.holiday.create({ data: { date, name, country } });
    return (row as any).id;
  }

  async remove(id: string): Promise<boolean> {
    const row = await this.ctx.prisma.holiday.findUnique({ where: { id } });
    if (!row) return false;
    await this.ctx.prisma.holiday.delete({ where: { id } });
    return true;
  }

  async movableForUser(userId: string, country: string): Promise<HolidayRow[]> {
    const [holidays, overrides] = await Promise.all([
      this.list(undefined, country),
      this.overridesForUser(userId),
    ]);
    return movableHolidays(holidays, overrides, country);
  }

  async overridesForUser(userId: string): Promise<OverrideRow[]> {
    const rows = await this.ctx.prisma.holidayOverride.findMany({ where: { userId } });
    return (rows as any[]).map(r => ({ holidayId: r.holidayId, newDate: r.newDate }));
  }

  async setOverride(
    userId: string, holidayId: string, newDate: Date, justification: string,
    country: string, tz: string,
  ): Promise<{ ok: true } | { ok: false; errors: ValidationError[] }> {
    const holiday = await this.ctx.prisma.holiday.findUnique({ where: { id: holidayId } });
    if (!holiday) {
      return { ok: false, errors: [{ field: 'holidayId', message: 'Feriado no encontrado' }] };
    }

    // Defensa en la ESCRITURA: nadie mueve el feriado de otro pais. El resolver
    // vuelve a filtrar por pais al LEER, porque el pais de un colaborador puede
    // cambiar despues de creado el override y dejarlo apuntando al pais viejo.
    if ((holiday as any).country !== country) {
      return {
        ok: false,
        errors: [{ field: 'holidayId', message: 'El feriado no corresponde a tu pais' }],
      };
    }

    const errors = validateOverrideInput((holiday as any).date, newDate, justification, tz);
    if (errors.length) return { ok: false, errors };

    await this.ctx.prisma.holidayOverride.upsert({
      where: { userId_holidayId: { userId, holidayId } },
      create: { userId, holidayId, newDate, justification: justification.trim() },
      update: { newDate, justification: justification.trim() },
    });
    return { ok: true };
  }

  async clearOverride(userId: string, holidayId: string): Promise<boolean> {
    const row = await this.ctx.prisma.holidayOverride.findUnique({
      where: { userId_holidayId: { userId, holidayId } },
    });
    if (!row) return false;
    await this.ctx.prisma.holidayOverride.delete({
      where: { userId_holidayId: { userId, holidayId } },
    });
    return true;
  }

  /**
   * Usuarios que hoy están de feriado. Un solo par de queries para toda la
   * oficina, no uno por persona.
   */
  async effectiveByUserId(
    now: Date,
    countryOf: Map<string, string>,
    tz: string,
  ): Promise<Set<string>> {
    const [holidays, allOverrides] = await Promise.all([
      this.ctx.prisma.holiday.findMany(),
      this.ctx.prisma.holidayOverride.findMany(),
    ]);

    const byUser = new Map<string, OverrideRow[]>();
    for (const o of allOverrides as any[]) {
      const list = byUser.get(o.userId) ?? [];
      list.push({ holidayId: o.holidayId, newDate: o.newDate });
      byUser.set(o.userId, list);
    }

    const result = new Set<string>();
    for (const [userId, country] of countryOf) {
      const on = isHolidayEffective({
        now,
        country,
        holidays: holidays as any as HolidayRow[],
        overrides: byUser.get(userId) ?? [],
        tz,
      });
      if (on) result.add(userId);
    }
    return result;
  }

  /** Justificación del override que cae hoy, para mostrarla en la tarjeta. */
  async overrideJustification(userId: string, now: Date, country: string, tz: string): Promise<string | null> {
    const today = localDateString(now, tz);
    const rows = await this.ctx.prisma.holidayOverride.findMany({ where: { userId } });
    for (const r of rows as any[]) {
      if (r.newDate.toISOString().slice(0, 10) === today) return r.justification;
    }
    return null;
  }
}
```

- [ ] **Step 2: Cablear los endpoints**

```ts
    const holidays = new HolidayService(ctx);

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
      const result = await holidays.setOverride(
        userId, req.params.id, new Date(newDate), justification ?? '', tz(),
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
```

- [ ] **Step 3: Verificar el tipado**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Probar con curl**

```bash
# Cargar el 15 de septiembre de Costa Rica
HID=$(curl -s -X POST localhost:3001/api/v1/p/office/holidays \
  -b $J -H 'Content-Type: application/json' \
  -d '{"date":"2026-09-15","name":"Independencia","country":"CR"}' | jq -r .id)

# Duplicado
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3001/api/v1/p/office/holidays \
  -b $J -H 'Content-Type: application/json' \
  -d '{"date":"2026-09-15","name":"Independencia","country":"CR"}'
# Expected: 409

# Override a otro mes: rechazado
curl -s -X POST localhost:3001/api/v1/p/office/holidays/$HID/override \
  -b $J -H 'Content-Type: application/json' \
  -d '{"newDate":"2026-10-02","justification":"lo tomo en octubre por carga de trabajo"}'
# Expected: 400, errors[].field == "newDate"

# Override dentro del mes: aceptado
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3001/api/v1/p/office/holidays/$HID/override \
  -b $J -H 'Content-Type: application/json' \
  -d '{"newDate":"2026-09-25","justification":"lo tomo el viernes 25 por cierre de mes"}'
# Expected: 201
```

- [ ] **Step 5: Commit**

```bash
git add src/services/holiday.service.ts src/index.ts
git commit -m "feat: add holiday calendar and per-user override"
```

---

### Task 14: Jerarquía y país desde Bitrix

El sistema no tiene jerarquía: `User` no tiene campo de jefe ni de departamento, y `bitrix.service.ts` hoy solo lee timeman y fotos. Sin esto la visibilidad restringida no puede incluir al jefe directo y los feriados no saben de qué país es cada quien.

**Files:**
- Create: `src/services/org.service.ts`
- Modify: `src/services/bitrix.service.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `BitrixUserMapping` con `departmentId`, `isDepartmentHead`, `country` (Task 3)
- Produces:
  - `BitrixService.syncOrgStructure(): Promise<{ synced: number; heads: number; withCountry: number }>`
  - `OrgService.managerOf(userId): Promise<string | null>`
  - `OrgService.isManagerOf(viewerId, targetId): Promise<boolean>`
  - `OrgService.managedUserIds(viewerId): Promise<Set<string>>`
  - `OrgService.countryOf(userId): Promise<string>`
  - `OrgService.countryByUserId(userIds): Promise<Map<string, string>>`
  - `OrgService.setOverride(userId, { managerUserId?, country? }): Promise<void>`

- [ ] **Step 1: Extender `BitrixService`**

En `src/services/bitrix.service.ts`, ampliar la interfaz y el `SELECT`:

```ts
export interface BitrixUser {
  ID: string;
  NAME: string;
  LAST_NAME: string;
  EMAIL: string;
  PERSONAL_PHOTO?: string;
  UF_DEPARTMENT?: number[];
  PERSONAL_COUNTRY?: string | number;
  ACTIVE: boolean;
}

export interface BitrixDepartment {
  ID: string;
  NAME: string;
  UF_HEAD?: string;
}
```

```ts
  async getBitrixUsers(): Promise<BitrixUser[]> {
    return this.ctx.bitrix!.callAll<BitrixUser>('user.get', {
      FILTER: { ACTIVE: true },
      SELECT: ['ID', 'NAME', 'LAST_NAME', 'EMAIL', 'PERSONAL_PHOTO',
               'UF_DEPARTMENT', 'PERSONAL_COUNTRY'],
    });
  }
```

Agregar el método de sincronización:

```ts
/**
 * IDs de país de Bitrix a ISO alpha-2. Bitrix guarda PERSONAL_COUNTRY como un
 * ID numérico de su propia lista, no como ISO. Solo se mapean los países donde
 * VLA tiene gente; un ID desconocido queda en null y el resolver cae al
 * DEFAULT_COUNTRY.
 */
const BITRIX_COUNTRY_ISO: Record<string, string> = {
  '1':  'CR', // Costa Rica
  '2':  'NI', // Nicaragua
  '3':  'PA', // Panamá
  '4':  'GT', // Guatemala
  '5':  'HN', // Honduras
  '6':  'SV', // El Salvador
};

  async syncOrgStructure(): Promise<{ synced: number; heads: number; withCountry: number }> {
    if (!this.isConfigured()) {
      this.ctx.logger.warn('Sync de organigrama omitido: Bitrix no configurado');
      return { synced: 0, heads: 0, withCountry: 0 };
    }

    const [departments, bitrixUsers, emailMap] = await Promise.all([
      this.ctx.bitrix!.callAll<BitrixDepartment>('department.get', {}),
      this.getBitrixUsers(),
      this.getVlaEmailMap(),
    ]);

    // departamento → bitrixId del jefe
    const headByDept = new Map<string, string>();
    for (const d of departments) {
      if (d.UF_HEAD) headByDept.set(String(d.ID), String(d.UF_HEAD));
    }

    let synced = 0, heads = 0, withCountry = 0;

    for (const bu of bitrixUsers) {
      const vlaUserId = emailMap.get((bu.EMAIL ?? '').toLowerCase());
      if (!vlaUserId) continue;

      const deptId = bu.UF_DEPARTMENT?.[0] != null ? String(bu.UF_DEPARTMENT[0]) : null;
      const isHead = deptId ? headByDept.get(deptId) === String(bu.ID) : false;

      const rawCountry = bu.PERSONAL_COUNTRY != null ? String(bu.PERSONAL_COUNTRY) : '';
      const country = BITRIX_COUNTRY_ISO[rawCountry] ?? null;
      if (rawCountry && !country) {
        this.ctx.logger.warn(`PERSONAL_COUNTRY desconocido "${rawCountry}" para ${bu.EMAIL}`);
      }

      await this.ctx.prisma.bitrixUserMapping.update({
        where: { userId: vlaUserId },
        data: { departmentId: deptId, isDepartmentHead: isHead, country },
      });

      synced++;
      if (isHead) heads++;
      if (country) withCountry++;
    }

    this.ctx.logger.log(
      `Organigrama: ${synced} usuarios, ${heads} jefes, ${withCountry} con país`,
    );
    return { synced, heads, withCountry };
  }
```

- [ ] **Step 2: Escribir `OrgService`**

Archivo `src/services/org.service.ts`:

```ts
import type { PluginContext } from '@vla/plugin-sdk';

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
    if ((override as any)?.managerUserId) return (override as any).managerUserId;

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
    const reassigned = await this.ctx.prisma.userProfileOverride.findMany({
      where: { userId: { in: [...result] }, NOT: { managerUserId: viewerId } },
    });
    for (const r of reassigned as any[]) {
      if (r.managerUserId) result.delete(r.userId);
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
```

- [ ] **Step 3: Cablear los endpoints y el cron**

```ts
    const org = new OrgService(ctx, () => (ctx.plugin.config.DEFAULT_COUNTRY as string) || 'CR');

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

    // Diagnóstico: cuántos usuarios traen país de Bitrix (admin)
    ctx.router.post('/org/sync', ctx.requireAuth(), ctx.requirePermission(PERMS.MANAGE), async (_req, res) => {
      res.json(await bitrix.syncOrgStructure());
    });
```

Y ahora que `OrgService` existe, se completa el `GET /absences` que la Task 12
dejó limitado a las ausencias propias. Reemplazar ese handler por:

```ts
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

      // La justificación de PERMISO e INCAPACIDAD se OMITE si no hay permiso:
      // no se manda vacía, el texto no viaja al cliente.
      res.json(rows.map(a => {
        if (RESTRICTED_ABSENCES.has(a.type) && !canSeeRestricted) {
          const { justification, ...rest } = a;
          return rest;
        }
        return a;
      }));
    });
```

El sync se suma al cron de 6 horas que ya existe para fotos, no a uno nuevo:

```ts
    ctx.cron('0 */6 * * *', async () => {
      await bitrix.syncPhotos();
      await bitrix.syncOrgStructure();
    });
```

- [ ] **Step 4: Verificar el tipado**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Medir qué tan lleno está Bitrix**

El riesgo del diseño: si `PERSONAL_COUNTRY` viene vacío, esa gente no recibe ningún feriado. Este paso mide el daño real antes de seguir.

```bash
curl -s -X POST localhost:3001/api/v1/p/office/org/sync \
  -b $J | jq
```

Expected: `{ "synced": N, "heads": M, "withCountry": K }`

Anotar los tres números. Si `withCountry` es mucho menor que `synced`, hay que cargar overrides de país a mano para el resto — se hace con `PUT /org/:userId` y no bloquea esta tarea. Si `heads` es 0, `UF_HEAD` no está configurado en Bitrix y la visibilidad por jefe directo no va a funcionar hasta que RRHH lo llene o se carguen overrides.

- [ ] **Step 6: Probar la resolución**

```bash
UID=$(curl -s localhost:3001/api/v1/p/office/snapshot -b $J | jq -r '.[0].userId')
curl -s localhost:3001/api/v1/p/office/org/$UID -b $J | jq

# Override manual de jefe y país
curl -s -X PUT localhost:3001/api/v1/p/office/org/$UID \
  -b $J -H 'Content-Type: application/json' \
  -d '{"country":"NI"}' | jq
curl -s localhost:3001/api/v1/p/office/org/$UID -b $J | jq .country
# Expected: "NI"
```

- [ ] **Step 7: Commit**

```bash
git add src/services/org.service.ts src/services/bitrix.service.ts src/index.ts
git commit -m "feat: sync Bitrix org structure, resolve manager and country with override"
```

---

### Task 15: Servicio de invitaciones a reunión

**Files:**
- Create: `src/services/meeting.service.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `nextInviteState`, `isExpired`, `INVITE_TTL_MS` (Task 11); `AbsenceService.activeByUserId` (Task 12); `PresenceService.updateStatus` (Task 16)
- Produces:
  - `MeetingService.invite(hostId, participantIds, justification): Promise<{ meetingId: string }>`
  - `MeetingService.pendingFor(userId): Promise<PendingInvite[]>`
  - `MeetingService.respond(inviteId, userId, action): Promise<{ ok: true } | { ok: false; reason: string }>`
  - `MeetingService.cancelMeeting(meetingId): Promise<string[]>` — devuelve los userId que hay que devolver a `AVAILABLE`
  - `MeetingService.leave(userId, meetingId): Promise<void>`

- [ ] **Step 1: Escribir el servicio**

Archivo `src/services/meeting.service.ts`:

```ts
import type { PluginContext } from '@vla/plugin-sdk';
import { nextInviteState, isExpired, type InviteAction } from '../lib/meeting-invites';

export interface PendingInvite {
  id: string;
  meetingId: string;
  hostId: string;
  hostName: string;
  justification: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export class MeetingService {
  constructor(
    private readonly ctx: PluginContext,
    private readonly broadcastToUser: (userId: string, payload: object) => void,
  ) {}

  async invite(
    hostId: string,
    participantIds: string[],
    _justification: string,
  ): Promise<{ meetingId: string }> {
    const meetingId = cryptoRandomId();

    // Si el host ya tenía una reunión abierta, se cierra antes de abrir otra.
    await this.cancelMeetingsHostedBy(hostId);

    for (const inviteeId of participantIds) {
      const row = await this.ctx.prisma.meetingInvite.create({
        data: { meetingId, hostId, inviteeId, state: 'PENDING' },
      });
      this.broadcastToUser(inviteeId, {
        type: 'meeting:invite',
        inviteId: (row as any).id,
        meetingId,
        hostId,
      });
    }

    return { meetingId };
  }

  async pendingFor(userId: string): Promise<PendingInvite[]> {
    const rows = await this.ctx.prisma.meetingInvite.findMany({
      where: { inviteeId: userId, state: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const live: any[] = [];
    for (const r of rows as any[]) {
      if (isExpired(r.createdAt, now)) {
        // Se barre al leer; no hay cron de vencimiento.
        await this.ctx.prisma.meetingInvite.update({
          where: { id: r.id },
          data: { state: 'EXPIRED' },
        });
      } else {
        live.push(r);
      }
    }
    if (!live.length) return [];

    const hostIds = [...new Set(live.map(r => r.hostId))];
    const [hosts, presences] = await Promise.all([
      this.ctx.prisma.user.findMany({
        where: { id: { in: hostIds } },
        select: { id: true, firstName: true, lastName: true },
      }),
      this.ctx.prisma.presenceStatus.findMany({ where: { userId: { in: hostIds } } }),
    ]);
    const nameOf = new Map((hosts as any[]).map(h => [h.id, `${h.firstName} ${h.lastName}`]));
    const justOf = new Map((presences as any[]).map(p => [p.userId, p.justification]));

    return live.map(r => ({
      id: r.id,
      meetingId: r.meetingId,
      hostId: r.hostId,
      hostName: nameOf.get(r.hostId) ?? 'Desconocido',
      justification: justOf.get(r.hostId) ?? null,
      createdAt: r.createdAt,
      expiresAt: new Date(r.createdAt.getTime() + 15 * 60 * 1000),
    }));
  }

  async respond(
    inviteId: string,
    userId: string,
    action: InviteAction,
  ): Promise<{ ok: true; meetingId: string; hostId: string } | { ok: false; reason: string }> {
    const row = await this.ctx.prisma.meetingInvite.findUnique({ where: { id: inviteId } });
    if (!row) return { ok: false, reason: 'not_found' };
    if ((row as any).inviteeId !== userId) return { ok: false, reason: 'not_yours' };

    const t = nextInviteState((row as any).state, action, (row as any).createdAt, new Date());
    if ('error' in t) {
      if (t.error === 'expired') {
        await this.ctx.prisma.meetingInvite.update({
          where: { id: inviteId },
          data: { state: 'EXPIRED' },
        });
      }
      return { ok: false, reason: t.error };
    }

    await this.ctx.prisma.meetingInvite.update({
      where: { id: inviteId },
      data: { state: t.state, respondedAt: new Date() },
    });

    return { ok: true, meetingId: (row as any).meetingId, hostId: (row as any).hostId };
  }

  /**
   * Cancela todas las invitaciones de las reuniones que hospeda este usuario.
   * Devuelve los userId que estaban ACCEPTED y hay que regresar a AVAILABLE.
   */
  async cancelMeetingsHostedBy(hostId: string): Promise<string[]> {
    const rows = await this.ctx.prisma.meetingInvite.findMany({
      where: { hostId, state: { in: ['PENDING', 'ACCEPTED'] } },
    });
    if (!rows.length) return [];

    const accepted = (rows as any[])
      .filter(r => r.state === 'ACCEPTED')
      .map(r => r.inviteeId);

    await this.ctx.prisma.meetingInvite.updateMany({
      where: { hostId, state: { in: ['PENDING', 'ACCEPTED'] } },
      data: { state: 'CANCELLED', respondedAt: new Date() },
    });

    for (const r of rows as any[]) {
      this.broadcastToUser(r.inviteeId, { type: 'meeting:cancelled', meetingId: r.meetingId });
    }

    return accepted;
  }

  /** El invitado se sale por su cuenta; la reunión sigue con el resto. */
  async leave(userId: string, meetingId: string): Promise<void> {
    await this.ctx.prisma.meetingInvite.updateMany({
      where: { inviteeId: userId, meetingId, state: 'ACCEPTED' },
      data: { state: 'CANCELLED', respondedAt: new Date() },
    });
  }

  async participantsOf(meetingId: string): Promise<string[]> {
    const rows = await this.ctx.prisma.meetingInvite.findMany({
      where: { meetingId, state: 'ACCEPTED' },
    });
    return (rows as any[]).map(r => r.inviteeId);
  }
}

function cryptoRandomId(): string {
  // El core corre en Node 18+, así que randomUUID está disponible sin import.
  return globalThis.crypto.randomUUID();
}
```

- [ ] **Step 2: Ampliar `PresenceService` — firma de `updateStatus` y broadcast dirigido**

Los dos cambios van juntos en esta tarea porque el Step 3 llama a `updateStatus`
con la firma nueva de tres argumentos: si el cambio de firma se dejara para la
Task 16, el `tsc` del Step 4 fallaría.

Reemplazar el tipo y el método `updateStatus` (líneas 113-128):

```ts
export type OfficeStatus =
  | 'AVAILABLE' | 'IN_MEETING_INTERNAL' | 'IN_MEETING_EXTERNAL'
  | 'FOCUS' | 'LUNCH' | 'BRB' | 'OFFLINE';

export interface StatusExtra {
  justification?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  meetingId?: string | null;
}

  async updateStatus(
    userId: string,
    status: OfficeStatus,
    extra: StatusExtra = {},
  ): Promise<PresenceRecord> {
    const now = new Date();
    const data = {
      status,
      justification:  extra.justification ?? null,
      statusStartsAt: extra.startsAt ?? null,
      statusEndsAt:   extra.endsAt ?? null,
      meetingId:      extra.meetingId ?? null,
      lastActivityAt: now,
    };

    const presence = await this.ctx.prisma.presenceStatus.upsert({
      where:  { userId },
      create: { userId, isCheckedIn: true, ...data },
      update: data,
    });

    const record = this.toRecord(presence);
    await this.ctx.redis.setJson(`presence:${userId}`, record, PRESENCE_CACHE_TTL);
    await this.ctx.hooks.doAction('office.user.status_changed', { userId, status });
    this.broadcast({ type: 'user:status', userId, status });

    return record;
  }
```

El `statusMessage` que había queda sin uso para esto: `justification` lo
reemplaza. No se borra la columna para no romper nada que la lea.

`checkIn()` ya fuerza `status: 'AVAILABLE'`; agregarle la limpieza del payload:

```ts
      create: { userId, isCheckedIn: true, status: 'AVAILABLE', lastActivityAt: now },
      update: {
        isCheckedIn: true, status: 'AVAILABLE', lastActivityAt: now,
        justification: null, statusStartsAt: null, statusEndsAt: null, meetingId: null,
      },
```

Y lo mismo en `checkOut()`, junto al `status: 'OFFLINE'` que ya pone.

Ahora el broadcast dirigido. El SSE de hoy manda a todos los clientes; una
invitación va a una sola persona. Reemplazar el registro de clientes:

```ts
  // ── SSE broadcast ─────────────────────────────────────────────────────────

  private clients = new Map<(data: string) => void, string | null>();

  subscribe(send: (data: string) => void, userId: string | null = null): () => void {
    this.clients.set(send, userId);
    return () => this.clients.delete(send);
  }

  private broadcast(payload: object): void {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const [send] of this.clients) {
      try { send(data); } catch { this.clients.delete(send); }
    }
  }

  /** Manda solo a las conexiones de ese usuario. Para invitaciones. */
  broadcastToUser(userId: string, payload: object): void {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const [send, uid] of this.clients) {
      if (uid !== userId) continue;
      try { send(data); } catch { this.clients.delete(send); }
    }
  }
```

En `src/index.ts`, donde se registra el endpoint de SSE, pasar el `userId` a `subscribe`:

```ts
      const unsubscribe = presence.subscribe(send, (req as any).user?.sub ?? null);
```

- [ ] **Step 3: Cablear los endpoints**

```ts
    const meetings = new MeetingService(ctx, (userId, payload) =>
      presence.broadcastToUser(userId, payload));

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
    // cambiar de estado con el selector, y el PATCH /presence/status de la Task 16
    // se encarga de cerrar su fila de MeetingInvite. Un endpoint aparte seria
    // saltable y exigiria una UI que el spec no pide.
```

Y el helper de mensajes, junto a las demás funciones del archivo:

```ts
function reasonMessage(reason: string): string {
  switch (reason) {
    case 'not_found':   return 'Invitación no encontrada';
    case 'not_yours':   return 'Esa invitación no es tuya';
    case 'expired':     return 'La invitación venció';
    case 'not_pending': return 'Esa invitación ya fue respondida';
    default:            return 'No se pudo procesar la invitación';
  }
}
```

- [ ] **Step 4: Verificar el tipado**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/meeting.service.ts src/services/presence.service.ts src/index.ts
git commit -m "feat: add meeting invitations with per-user SSE delivery"
```

---

### Task 16: Presencia con payload y validación

**Files:**
- Modify: `src/services/presence.service.ts`
- Modify: `src/index.ts:79-83`

**Interfaces:**
- Consumes: `validateStatusInput` (Task 6), `AbsenceService.activeByUserId` (Task 12), `MeetingService` (Task 15)
- Produces:
  - `PresenceService.updateStatus(userId, status, extra?): Promise<PresenceRecord>` donde `extra` = `{ justification?: string | null; startsAt?: Date | null; endsAt?: Date | null; meetingId?: string | null }`
  - `PATCH /presence/status` validado y con permiso `office.checkin`

La firma de `updateStatus` y la limpieza del payload en `checkIn`/`checkOut` ya
se hicieron en el Step 2 de la Task 15 — esa tarea las necesitaba para compilar.
Esta tarea es solo el endpoint y su validación.

- [ ] **Step 1: Reemplazar el endpoint sin validación**

En `src/index.ts`, el bloque de las líneas 79-83 pasa a:

```ts
    ctx.router.patch('/presence/status', ctx.requireAuth(), ctx.requirePermission(PERMS.CHECKIN), async (req, res) => {
      const userId = (req as any).user?.sub;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });

      const body = req.body as StatusInput & { participantIds?: string[] };

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
      // Dos casos distintos y los dos hacen falta.
      //
      // 1. El host cambia de estado: se cancelan sus invitaciones y los que
      //    habían aceptado vuelven a AVAILABLE.
      const returning = await meetings.cancelMeetingsHostedBy(userId);
      for (const participantId of returning) {
        await presence.updateStatus(participantId, 'AVAILABLE');
      }

      // 2. Un INVITADO que había aceptado cambia de estado por su cuenta. Sin
      //    esto su fila de MeetingInvite queda en ACCEPTED, y como el snapshot
      //    arma `meetingWith` leyendo justamente las filas ACCEPTED, la tarjeta
      //    del host seguiría diciendo "Con Beto" después de que Beto se fue.
      const before = await ctx.prisma.presenceStatus.findUnique({ where: { userId } });
      const previousMeetingId = (before as any)?.meetingId ?? null;
      // Sin condicion sobre el estado nuevo: un invitado que acepto y ahora
      // arma SU PROPIA reunion interna tambien tiene que soltar la fila vieja.
      // Para un anfitrion la llamada es no-op garantizado, porque leave() solo
      // matchea inviteeId === userId y `participantIds` excluye al propio host,
      // asi que nadie tiene fila de invitado en su propia reunion.
      if (previousMeetingId) {
        await meetings.leave(userId, previousMeetingId);
      }

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
```

`setManualOverride` ya existe y marca 10 minutos en Redis para que el cron de timeman no pise lo que la persona eligió a mano.

- [ ] **Step 2: Actualizar el payload declarado del hook**

En `src/index.ts:245`, el `declareHook` de `office.user.status_changed` sigue anunciando los estados viejos:

```ts
      payload: {
        userId: 'string',
        status: 'AVAILABLE | IN_MEETING_INTERNAL | IN_MEETING_EXTERNAL | FOCUS | LUNCH | BRB',
      },
```

- [ ] **Step 3: Verificar el tipado**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Probar la validación con curl**

```bash
P=localhost:3001/api/v1/p/office/presence/status
H=(-b $J -H 'Content-Type: application/json')

# Estado inexistente — el bug que había hoy
curl -s -X PATCH $P "${H[@]}" -d '{"status":"PARRANDA"}' | jq
# Expected: 400, errors[0].field == "status"

# BUSY, que se eliminó
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH $P "${H[@]}" -d '{"status":"BUSY"}'
# Expected: 400

# OFFLINE desde la API
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH $P "${H[@]}" -d '{"status":"OFFLINE"}'
# Expected: 400

# FOCUS sin justificación
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH $P "${H[@]}" -d '{"status":"FOCUS"}'
# Expected: 400

# FOCUS con 9 caracteres
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH $P "${H[@]}" \
  -d '{"status":"FOCUS","justification":"123456789"}'
# Expected: 400

# FOCUS con 10
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH $P "${H[@]}" \
  -d '{"status":"FOCUS","justification":"1234567890"}'
# Expected: 200

# LUNCH sin rango
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH $P "${H[@]}" -d '{"status":"LUNCH"}'
# Expected: 400

# Invitar a alguien de vacaciones (usa el id de la ausencia creada en la Task 12)
curl -s -X PATCH $P "${H[@]}" -d "{\"status\":\"IN_MEETING_INTERNAL\",
  \"justification\":\"seguimiento semanal del equipo\",\"participantIds\":[\"$UID\"]}" | jq
# Expected: 400 con unavailable[].reason == "VACACIONES" si la ausencia está activa hoy
```

- [ ] **Step 5: Verificar el cambio de permiso**

El endpoint pasó de `office.view` a `office.checkin`. Hay que confirmar que un usuario con solo `view` recibe 403 y que el rol normal sigue funcionando.

```bash
# Con un token de un usuario que solo tenga office.view
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH $P \
  -b /tmp/vla-cookies-viewonly.txt -H 'Content-Type: application/json' \
  -d '{"status":"AVAILABLE"}'
# Expected: 403
```

Si no hay un rol así configurado, crear uno temporal con `office.view` desde la pantalla de roles del core. **No omitir este paso:** es un cambio de permiso en un endpoint existente y si algún cliente hoy cambia estado con solo `view`, se rompe en producción.

- [ ] **Step 6: Commit**

```bash
git add src/services/presence.service.ts src/index.ts
git commit -m "feat: validate status payload, require office.checkin, wire meeting invites"
```

---

### Task 17: Snapshot con resolver y visibilidad

Punto único donde se compone lo que ve la oficina. Cambia de firma: `getAll()` pasa a `getAll({ userId, hasManage })`.

**Files:**
- Modify: `src/services/snapshot.service.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `resolveStatus` (Task 9), `canSeeJustification` (Task 10), `AbsenceService.activeByUserId`, `HolidayService.effectiveByUserId` / `.overrideJustification`, `OrgService.managedUserIds` / `.countryByUserId`
- Produces: `SnapshotService.getAll(viewer: { userId: string; hasManage: boolean }): Promise<UserSnapshot[]>` con `status` resuelto, `rawStatus`, `isAbsent`, `justification` omitido según permiso, `absenceEndsAt`, `meetingWith`

- [ ] **Step 1: Ampliar `UserSnapshot`**

En `src/services/snapshot.service.ts`:

```ts
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
  avatar: { /* sin cambios */ } | null;
}
```

- [ ] **Step 2: Reescribir `getAll`**

El constructor recibe los servicios nuevos:

```ts
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

    // Participantes de las reuniones internas que están abiertas.
    const meetingIds = [...new Set(
      (presences as any[]).map(p => p.meetingId).filter(Boolean),
    )];
    const participantsByMeeting = await this.loadMeetingParticipants(meetingIds, users as any[]);

    const out: UserSnapshot[] = [];
    for (const u of users as any[]) {
      const p = presenceMap.get(u.id);
      const a = avatarMap.get(u.id);
      const absence = activeAbsences.get(u.id);

      const resolved = resolveStatus({
        presenceStatus: (p?.status ?? 'OFFLINE') as any,
        presenceJustification: p?.justification ?? null,
        absences: absence ? [absence] : [],
        isHolidayToday: onHoliday.has(u.id),
        now,
      });

      // La justificación de un feriado movido vive en el override.
      let justification = resolved.justification;
      if (resolved.status === 'FERIADO') {
        // El filtro de pais va tambien en esta segunda ruta de lectura: un
        // override viejo puede apuntar al feriado del pais anterior si RRHH
        // corrigio el pais del colaborador.
        justification = await this.holidays.overrideJustification(
          u.id, now, countryOf.get(u.id)!, this.tzOf());
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
        meetingWith:    p?.meetingId ? participantsByMeeting.get(p.meetingId) : undefined,
        currentZoneId: p?.currentZoneId ?? undefined,
        defaultZoneId: p?.defaultZoneId ?? undefined,
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
      if (justification && canSeeJustification(viewerCtx, u.id, resolved.status as any)) {
        snap.justification = justification;
      }

      out.push(snap);
    }

    return out;
  }

  private async loadMeetingParticipants(
    meetingIds: string[],
    users: { id: string; firstName: string; lastName: string }[],
  ): Promise<Map<string, { userId: string; firstName: string; lastName: string }[]>> {
    const result = new Map<string, { userId: string; firstName: string; lastName: string }[]>();
    if (!meetingIds.length) return result;

    const invites = await this.ctx.prisma.meetingInvite.findMany({
      where: { meetingId: { in: meetingIds }, state: 'ACCEPTED' },
    });
    const nameOf = new Map(users.map(u => [u.id, u]));

    for (const i of invites as any[]) {
      const u = nameOf.get(i.inviteeId);
      if (!u) continue;
      const list = result.get(i.meetingId) ?? [];
      list.push({ userId: u.id, firstName: u.firstName, lastName: u.lastName });
      result.set(i.meetingId, list);
    }
    return result;
  }
```

- [ ] **Step 3: Actualizar los llamadores**

`SnapshotService` ahora recibe `absences`, `holidays` y `org` en el constructor, asi que en `index.ts` hay que crearlo **despues** de esos tres. Mover su instanciacion si quedo arriba.

Buscar todos los usos y pasarles el viewer:

```bash
grep -n "snapshot.getAll\|snapshots.getAll" src/index.ts
```

Cada uno pasa a:

```ts
      const snap = await snapshot.getAll({
        userId: (req as any).user.sub,
        hasManage: can(req, PERMS.MANAGE),
      });
```

El endpoint de snapshot ya tiene `requireAuth()`, así que `sub` siempre está.

- [ ] **Step 4: Verificar el tipado**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Probar la matriz de visibilidad**

Este es el paso que más importa de la tarea. Con el usuario de la Task 12, que tiene vacaciones registradas, y una incapacidad con justificación:

```bash
# Registrar una incapacidad para hoy con justificación
curl -s -X POST localhost:3001/api/v1/p/office/absences \
  -b $J -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$UID\",\"type\":\"INCAPACIDAD\",
       \"startAt\":\"$(date -u -d "$(date +%Y-%m-%d) 06:00" +%Y-%m-%dT%H:%M:%SZ)\",
       \"endAt\":\"$(date -u -d "$(date -d tomorrow +%Y-%m-%d) 05:59" +%Y-%m-%dT%H:%M:%SZ)\",
       \"justification\":\"Boleta CCSS 4477-2026\"}"

# Como admin (tiene office.manage): la ve
curl -s localhost:3001/api/v1/p/office/snapshot -b $J \
  | jq --arg u "$UID" '.[] | select(.userId==$u) | {status, isAbsent, justification}'
# Expected: status "INCAPACIDAD", isAbsent true, justification presente

# Como un tercero sin office.manage y que no es su jefe
curl -s localhost:3001/api/v1/p/office/snapshot -b /tmp/vla-cookies-otro.txt \
  | jq --arg u "$UID" '.[] | select(.userId==$u) | has("justification")'
# Expected: false — la clave NO existe, no viene vacía
```

El `has("justification")` es el aserto correcto: comprueba que el campo se omitió, no que llegó vacío.

- [ ] **Step 6: Commit**

```bash
git add src/services/snapshot.service.ts src/index.ts
git commit -m "feat: resolve visible state in snapshot, gate justification by viewer"
```

---

### Task 18: Blindar el cron de Bitrix

**Sin esta tarea la feature no funciona.** `runTimemanSync` corre cada 2 minutos y manda a `OFFLINE` a quien tenga timeman cerrado. El de vacaciones tiene timeman cerrado, así que el sistema le borraría el estado cada 2 minutos.

**Files:**
- Modify: `src/index.ts:255-270` (auto-checkout de 8h)
- Modify: `src/index.ts:278-305` (`runTimemanSync`)

**Interfaces:**
- Consumes: `AbsenceService.activeByUserId`, `HolidayService.effectiveByUserId`, `OrgService.countryByUserId`
- Produces: `runTimemanSync(): Promise<{ synced; errors; skipped; skippedByAbsence }>`

- [ ] **Step 1: Extraer el set de ausentes**

En `src/index.ts`, antes de `runTimemanSync`:

```ts
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
```

- [ ] **Step 2: Blindar `runTimemanSync`**

```ts
    async function runTimemanSync(): Promise<{ synced: number; errors: number; skipped: number; skippedByAbsence: number }> {
      const now = new Date();
      const absent = await absentUserIds(now);
      const statuses = await bitrix.syncTimemanStatuses();

      let synced = 0, errors = 0, skipped = 0, skippedByAbsence = 0;

      for (const { userId, isOpen } of statuses) {
        try {
          // Una ausencia o un feriado gana sobre lo que diga timeman.
          if (absent.has(userId)) { skippedByAbsence++; continue; }

          if (await presence.hasManualOverride(userId)) { skipped++; continue; }

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
```

El contador `skippedByAbsence` en el log es lo que permite diagnosticar si el blindaje dejó de funcionar.

- [ ] **Step 3: Blindar el auto-checkout de 8 horas**

No tiene sentido cerrar por inactividad a quien está de incapacidad.

```ts
      const threshold = new Date(Date.now() - 8 * 60 * 60 * 1000);
      const absent = await absentUserIds(new Date());
      const stale = await ctx.prisma.presenceStatus.findMany({
        where: { isCheckedIn: true, lastActivityAt: { lt: threshold } },
      });
      for (const p of stale) {
        const userId = (p as any).userId;
        if (absent.has(userId)) {
          ctx.logger.log(`Auto checkout omitido por ausencia: ${userId}`);
          continue;
        }
        await presence.checkOut(userId, 'WEB');
        // ...el resto sin cambios
      }
```

- [ ] **Step 4: Verificar el tipado**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Probar la regresión que importa**

Esta es la prueba que valida toda la fase: un usuario con vacaciones activas y timeman cerrado tiene que sobrevivir al cron.

**Ojo con `date -u -d 'today ...'`.** La bandera `-u` hace que GNU date
interprete `'today'` contra la fecha **UTC**, no la local. Corriendo despues de las
18:00 hora local (UTC-6), `'today'` ya es el dia siguiente en UTC y el comando arma
la ventana equivocada sin avisar. Calcula la fecha local por separado
(`$(date +%Y-%m-%d)`, sin `-u`) y pasasela al `-u -d`.

```bash
# 1. Registrar vacaciones que cubran hoy para $UID
curl -s -X POST localhost:3001/api/v1/p/office/absences \
  -b $J -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$UID\",\"type\":\"VACACIONES\",
       \"startAt\":\"$(date -u -d 'yesterday 06:00' +%Y-%m-%dT%H:%M:%SZ)\",
       \"endAt\":\"$(date -u -d '+7 days' +%Y-%m-%dT%H:%M:%SZ)\"}"

# 2. Estado antes
curl -s localhost:3001/api/v1/p/office/snapshot -b $J \
  | jq --arg u "$UID" '.[] | select(.userId==$u) | {status, rawStatus, isAbsent}'
# Expected: status "VACACIONES", isAbsent true

# 3. Forzar el sync
curl -s -X POST localhost:3001/api/v1/p/office/timeman/sync -b $J | jq
# Expected: skippedByAbsence >= 1

# 4. Estado después: idéntico
curl -s localhost:3001/api/v1/p/office/snapshot -b $J \
  | jq --arg u "$UID" '.[] | select(.userId==$u) | {status, rawStatus, isAbsent}'
# Expected: status sigue en "VACACIONES"
```

Si no existe el endpoint `POST /timeman/sync`, agregarlo con `PERMS.MANAGE` llamando a `runTimemanSync()` — ya hay uno de depuración de timeman en `index.ts:177` que sirve de modelo.

- [ ] **Step 6: Verificar que no hay regresión en el resto**

Un usuario **sin** ausencia tiene que seguir sincronizando igual que antes.

```bash
curl -s -X POST localhost:3001/api/v1/p/office/timeman/sync -b $J | jq
```

Expected: `synced` y `skipped` con valores parecidos a los de antes del cambio; `errors` en 0.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "fix: skip absent users in timeman sync and inactivity auto-checkout"
```

---

## Fase 3 — Frontend

El frontend no tiene infraestructura de pruebas y montarla es su propio proyecto. En su lugar, esta fase se apoya en el compilador: los mapas de configuración se declaran como `Record` exhaustivos sobre un tipo unión, así que olvidar un estado rompe el build en vez de fallar callado en producción. La verificación es `npm run build` más una pasada por el navegador.

### Task 19: Configuración de estados unificada

Los colores están duplicados en tres archivos: `STATUS_CFG` en `App.tsx`, `STATUS_RING` en `ZoneTile.tsx` y `STATUS_RING` otra vez en `ZoneListView.tsx`. Los tres siguen listando `BUSY` e `IN_MEETING`, que ya no existen. Con 11 estados se desincronizan seguro.

**Files:**
- Create: `frontend/src/statusConfig.ts`
- Modify: `frontend/src/App.tsx` (quita `STATUS_CFG` y `STATUSES`)
- Modify: `frontend/src/components/ZoneTile.tsx` (quita `STATUS_RING`)
- Modify: `frontend/src/components/ZoneListView.tsx` (quita `STATUS_RING`)
- Modify: `frontend/src/components/StatusSelector.tsx` (cambia el import; además usa
  `st.color` como clase de texto en dos puntos — pasa a `st.text`)
- Modify: `frontend/src/components/HoverCard.tsx` (cambia el import; `st.color` → `st.text`)
- Modify: `frontend/src/components/AvatarSVG.tsx` (indexa `STATUS_CFG` directo)
- Modify: `frontend/src/components/Sidebar.tsx` (indexa `STATUS_CFG` directo y usa
  `st.color` como clase de texto)

Son **siete** archivos, no cinco. `git grep -l 'STATUS_CFG\|STATUS_RING' -- frontend/src`
los lista todos: al sacar `STATUS_CFG` de `App.tsx`, los siete se rompen.

**Interfaces:**
- Consumes: nada
- Produces:
  - `ResolvedStatus` (tipo unión de los 11)
  - `STATUS_CFG: Record<ResolvedStatus, StatusCfg>` donde `StatusCfg` = `{ label: string; color: string; dot: string; text: string; icon?: string; group: 'day' | 'absence' | 'system'; payload: PayloadKind }`
  - `PayloadKind` = `'none' | 'justification' | 'timeRange' | 'participants' | 'dateRange' | 'permiso' | 'holidayOverride'`
  - `SELECTABLE: ResolvedStatus[]`
  - `DAY_GROUP`, `ABSENCE_GROUP: ResolvedStatus[]`

- [ ] **Step 1: Crear el archivo**

Archivo `frontend/src/statusConfig.ts`:

```ts
export type ResolvedStatus =
  | 'AVAILABLE' | 'FOCUS' | 'IN_MEETING_INTERNAL' | 'IN_MEETING_EXTERNAL'
  | 'LUNCH' | 'BRB' | 'OFFLINE'
  | 'PERMISO' | 'VACACIONES' | 'INCAPACIDAD' | 'FERIADO';

export type PayloadKind =
  | 'none'
  | 'justification'
  | 'timeRange'
  | 'participants'
  | 'dateRange'
  | 'permiso'
  | 'holidayOverride';

export interface StatusCfg {
  label: string;
  /** Color del anillo del avatar. */
  color: string;
  /** Clase Tailwind del punto. */
  dot: string;
  /** Clase Tailwind del texto. */
  text: string;
  /** Solo en ausencias: las distingue del grupo del día. */
  icon?: string;
  group: 'day' | 'absence' | 'system';
  payload: PayloadKind;
}

/**
 * Record exhaustivo a propósito: agregar un miembro a ResolvedStatus sin
 * agregarlo acá rompe el build. Es la red que reemplaza a las pruebas de UI.
 *
 * Los estados del día usan color saturado; las ausencias usan tono apagado más
 * un ícono, para que se lean como dos grupos distintos sin inventar cuatro
 * matices que nadie distingue.
 */
export const STATUS_CFG: Record<ResolvedStatus, StatusCfg> = {
  AVAILABLE:           { label: 'Disponible',         color: '#4ade80', dot: 'bg-green-400',  text: 'text-green-600',  group: 'day',     payload: 'none' },
  FOCUS:               { label: 'Concentrado',        color: '#60a5fa', dot: 'bg-blue-400',   text: 'text-blue-600',   group: 'day',     payload: 'justification' },
  IN_MEETING_INTERNAL: { label: 'En reunión interna', color: '#c084fc', dot: 'bg-purple-400', text: 'text-purple-600', group: 'day',     payload: 'participants' },
  IN_MEETING_EXTERNAL: { label: 'En reunión externa', color: '#7c3aed', dot: 'bg-violet-600', text: 'text-violet-700', group: 'day',     payload: 'justification' },
  LUNCH:               { label: 'Almuerzo',           color: '#fb923c', dot: 'bg-orange-400', text: 'text-orange-500', group: 'day',     payload: 'timeRange' },
  BRB:                 { label: 'Vuelvo pronto',      color: '#facc15', dot: 'bg-yellow-400', text: 'text-yellow-600', group: 'day',     payload: 'justification' },
  OFFLINE:             { label: 'Desconectado',       color: '#d1d5db', dot: 'bg-gray-300',   text: 'text-gray-400',   group: 'system',  payload: 'none' },
  PERMISO:             { label: 'Permiso',            color: '#94a3b8', dot: 'bg-slate-400',  text: 'text-slate-600',  icon: '📄', group: 'absence', payload: 'permiso' },
  VACACIONES:          { label: 'Vacaciones',         color: '#7dd3fc', dot: 'bg-sky-300',    text: 'text-sky-600',    icon: '🏖', group: 'absence', payload: 'dateRange' },
  INCAPACIDAD:         { label: 'Incapacidad',        color: '#fca5a5', dot: 'bg-red-300',    text: 'text-red-500',    icon: '🏥', group: 'absence', payload: 'dateRange' },
  FERIADO:             { label: 'Feriado',            color: '#fcd34d', dot: 'bg-amber-300',  text: 'text-amber-600',  icon: '🎉', group: 'absence', payload: 'holidayOverride' },
};

export const DAY_GROUP: ResolvedStatus[] =
  (Object.keys(STATUS_CFG) as ResolvedStatus[]).filter(s => STATUS_CFG[s].group === 'day');

export const ABSENCE_GROUP: ResolvedStatus[] =
  (Object.keys(STATUS_CFG) as ResolvedStatus[]).filter(s => STATUS_CFG[s].group === 'absence');

/** Lo que el colaborador puede elegir. OFFLINE lo escribe solo el sistema. */
export const SELECTABLE: ResolvedStatus[] = [...DAY_GROUP, ...ABSENCE_GROUP];

export const MIN_JUSTIFICATION = 10;

export function cfgOf(status: string): StatusCfg {
  return STATUS_CFG[status as ResolvedStatus] ?? STATUS_CFG.OFFLINE;
}
```

- [ ] **Step 2: Quitar los tres mapas duplicados**

En `frontend/src/App.tsx`, borrar el bloque `const STATUSES = [...]`, el `export { STATUSES }` y todo el `export const STATUS_CFG = {...}` (líneas 15-26). Dejar el `export const TILE = 20`.

En `frontend/src/components/ZoneTile.tsx`, borrar el `const STATUS_RING = {...}` y agregar el import:

```ts
import { cfgOf } from '../statusConfig';
```

Cada uso de `STATUS_RING[u.status]` pasa a `cfgOf(u.status).color`.

En `frontend/src/components/ZoneListView.tsx`, lo mismo: borrar su `STATUS_RING` y usar `cfgOf`.

- [ ] **Step 3: Actualizar los imports de los consumidores**

En `StatusSelector.tsx`:

```ts
import { cfgOf, SELECTABLE, STATUS_CFG } from '../statusConfig';
```

En `HoverCard.tsx`:

```ts
import { cfgOf } from '../statusConfig';
```

y `const st = STATUS_CFG[user.status] ?? STATUS_CFG['OFFLINE']` pasa a `const st = cfgOf(user.status)`. Los usos de `st.color` que antes eran clases de texto pasan a `st.text`.

- [ ] **Step 4: Verificar que compila**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS. Cualquier error acá es un uso de `STATUS_CFG` o `STATUS_RING` que quedó sin migrar — arreglarlo antes de seguir.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/statusConfig.ts frontend/src/App.tsx \
        frontend/src/components/ZoneTile.tsx \
        frontend/src/components/ZoneListView.tsx \
        frontend/src/components/StatusSelector.tsx \
        frontend/src/components/HoverCard.tsx
git commit -m "refactor(ui): unify status config, drop three duplicated color maps"
```

---

### Task 20: Tipos y cliente de API del frontend

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

**Interfaces:**
- Consumes: la forma de `UserSnapshot` de la Task 17
- Produces: `UserSnapshot` con los campos nuevos; funciones `setStatus`, `createAbsence`, `listAbsences`, `deleteAbsence`, `listHolidays`, `listMovableHolidays`, `createHoliday`, `deleteHoliday`, `setHolidayOverride`, `listInvites`, `respondInvite`, `getOrg`, `setOrg`

- [ ] **Step 1: Ampliar `UserSnapshot` en `types.ts`**

Sobre la interfaz que ya está, agregar:

```ts
  /** Estado resuelto: ya incluye ausencias y feriados. */
  status: string;
  /** PresenceStatus.status sin resolver. Para diagnosticar. */
  rawStatus: string;
  /** El estado viene de una ausencia o feriado; el avatar se pinta igual. */
  isAbsent: boolean;
  /** Ausente si el viewer no tiene permiso de verla. */
  justification?: string;
  statusStartsAt?: string;
  statusEndsAt?: string;
  absenceEndsAt?: string;
  meetingId?: string;
  meetingWith?: { userId: string; firstName: string; lastName: string }[];
```

Y los tipos nuevos:

```ts
export interface Absence {
  id: string;
  userId: string;
  type: 'PERMISO' | 'VACACIONES' | 'INCAPACIDAD';
  startAt: string;
  endAt: string;
  justification?: string;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  country: string;
}

export interface PendingInvite {
  id: string;
  meetingId: string;
  hostId: string;
  hostName: string;
  justification: string | null;
  expiresAt: string;
}

export interface UnavailableParticipant {
  userId: string;
  name: string;
  reason: string;
  until: string | null;
}
```

- [ ] **Step 2: Agregar las llamadas en `api.ts`**

**Antes de escribir nada, leer `frontend/src/api.ts`.** Son 18 líneas: un
`request<T>(method, path, body)` privado y un objeto `api` con `get`, `post` y
`patch`. Los helpers `apiFetch` / `postJson` / `getJson` / `putJson` / `del` que
aparecen abajo **no existen** — usar el objeto `api`, que es el estilo de la casa.

Y todo path del plugin lleva el prefijo **`/p/office`**: `api.get('/absences')`
pega a `/api/v1/absences` y da 404. Definir `const PLUGIN = '/p/office'` y
componer con eso, igual que `/p/office/snapshot` y `/p/office/layout`, que es
como llama el resto del frontend.


Siguiendo el estilo del archivo (mismo helper de fetch y de manejo de error):

```ts
export interface StatusPayload {
  status: string;
  justification?: string;
  startsAt?: string;
  endsAt?: string;
  participantIds?: string[];
}

/** Devuelve la lista de ausentes cuando el backend rechaza la invitación. */
export interface StatusError {
  message: string;
  errors?: { field: string; message: string }[];
  unavailable?: UnavailableParticipant[];
}

export async function setStatus(payload: StatusPayload): Promise<void> {
  const res = await apiFetch('/presence/status', { method: 'PATCH', body: JSON.stringify(payload) });
  if (!res.ok) throw Object.assign(new Error('status'), { detail: await res.json() as StatusError });
}

export const createAbsence = (body: {
  type: string; startAt: string; endAt: string; justification?: string;
}) => postJson('/absences', body);

export const listAbsences = (userId?: string) =>
  getJson<Absence[]>(`/absences${userId ? `?userId=${userId}` : ''}`);

export const deleteAbsence = (id: string) => del(`/absences/${id}`);

export const listHolidays = (year?: number, country?: string) =>
  getJson<Holiday[]>(`/holidays?${new URLSearchParams({
    ...(year ? { year: String(year) } : {}),
    ...(country ? { country } : {}),
  })}`);

export const listMovableHolidays = () => getJson<Holiday[]>('/holidays/movable');

export const createHoliday = (body: { date: string; name: string; country: string }) =>
  postJson('/holidays', body);

export const deleteHoliday = (id: string) => del(`/holidays/${id}`);

export const setHolidayOverride = (holidayId: string, body: { newDate: string; justification: string }) =>
  postJson(`/holidays/${holidayId}/override`, body);

export const listInvites = () => getJson<PendingInvite[]>('/meetings/invites');

export const respondInvite = (id: string, action: 'accept' | 'decline') =>
  postJson(`/meetings/invites/${id}/${action}`, {});

export const getOrg = (userId: string) =>
  getJson<{ userId: string; managerUserId: string | null; country: string }>(`/org/${userId}`);

export const setOrg = (userId: string, body: { managerUserId?: string | null; country?: string | null }) =>
  putJson(`/org/${userId}`, body);
```

Si `api.ts` no tiene todavía los helpers `postJson`, `getJson`, `putJson` y `del`, escribirlos sobre el `apiFetch` que ya usa el archivo, con el mismo manejo de error que las funciones existentes.

- [ ] **Step 3: Verificar que compila**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat(ui): add types and API calls for absences, holidays and invites"
```

---

### Task 21: Selector y modales de payload

**Files:**
- Modify: `frontend/src/components/StatusSelector.tsx`
- Create: `frontend/src/components/modalParts.tsx` (`Shell`, `TimeField`, `DateField`, `Actions` — los usan T22 y T23)
- Create: `frontend/src/components/JustificationModal.tsx`
- Create: `frontend/src/components/TimeRangeModal.tsx`
- Create: `frontend/src/components/DateRangeModal.tsx`
- Create: `frontend/src/components/PermisoModal.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `SELECTABLE`, `DAY_GROUP`, `ABSENCE_GROUP`, `cfgOf`, `MIN_JUSTIFICATION` (Task 19); `setStatus`, `createAbsence` (Task 20)
- Produces:
  - `StatusSelector` con grupos y prop `onPick(status: ResolvedStatus)`
  - Cada modal expone `{ open, onClose, onConfirm }` con su payload propio

- [ ] **Step 1: Agrupar el selector**

En `StatusSelector.tsx`, el mapa sobre `STATUSES` pasa a recorrer los dos grupos con un separador. La prop `onChange` se renombra a `onPick` porque ya no aplica el estado: abre el modal que corresponda.

```tsx
      {open && (
        <div className={`absolute ${dropUp ? 'bottom-full mb-1' : 'top-full mt-1'} right-0 w-52 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-40`}>
          <Group title="Estado del día" items={DAY_GROUP} current={current} onPick={pick} />
          <div className="border-t border-gray-100" />
          <Group title="Ausencia" items={ABSENCE_GROUP} current={current} onPick={pick} />
        </div>
      )}
```

```tsx
function Group({ title, items, current, onPick }: {
  title: string;
  items: ResolvedStatus[];
  current: string;
  onPick: (s: ResolvedStatus) => void;
}) {
  return (
    <div>
      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </div>
      {items.map(s => {
        const cfg = STATUS_CFG[s];
        return (
          <button
            key={s}
            onClick={() => onPick(s)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${current === s ? 'bg-gray-50 font-semibold' : ''}`}
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
            <span className={cfg.text}>{cfg.label}</span>
            {cfg.icon && <span className="ml-auto text-xs">{cfg.icon}</span>}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Escribir `JustificationModal`**

El botón dice cuántos caracteres faltan en vez de solo estar apagado.

```tsx
import { useState } from 'react';
import { MIN_JUSTIFICATION, cfgOf } from '../statusConfig';

export function JustificationModal({ status, onClose, onConfirm }: {
  status: string;
  onClose: () => void;
  onConfirm: (justification: string) => void;
}) {
  const [text, setText] = useState('');
  const missing = Math.max(0, MIN_JUSTIFICATION - text.trim().length);
  const cfg = cfgOf(status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="mb-1 flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
          <h2 className="text-sm font-semibold text-gray-800">{cfg.label}</h2>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Escribí qué respalda este estado. Tus compañeros lo van a ver.
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-xl border border-gray-200 p-2.5 text-xs focus:border-gray-400 focus:outline-none"
          placeholder="Cerrando el reporte de cobros de septiembre"
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100">
            Cancelar
          </button>
          <button
            disabled={missing > 0}
            onClick={() => onConfirm(text.trim())}
            className="rounded-xl bg-gray-800 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-gray-300"
          >
            {missing > 0 ? `Faltan ${missing} caracteres` : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Escribir `TimeRangeModal`**

Dos `<input type="time">`. Devuelve los dos instantes ya en ISO, construidos sobre el día de hoy del navegador — que corre en la zona del colaborador, así que no hay corrimiento.

```tsx
import { useState } from 'react';

export function TimeRangeModal({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (startsAt: string, endsAt: string) => void;
}) {
  const [from, setFrom] = useState('12:00');
  const [to, setTo] = useState('13:00');
  const invalid = to <= from;

  const toIso = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };

  return (
    <Shell title="Almuerzo" onClose={onClose}>
      <div className="flex items-center gap-2">
        <TimeField label="Desde" value={from} onChange={setFrom} />
        <TimeField label="Hasta" value={to} onChange={setTo} />
      </div>
      {invalid && <p className="mt-2 text-xs text-red-500">La hora de fin debe ser posterior.</p>}
      <Actions
        onClose={onClose}
        disabled={invalid}
        onConfirm={() => onConfirm(toIso(from), toIso(to))}
      />
    </Shell>
  );
}
```

`Shell`, `TimeField`, `DateField` y `Actions` son los envoltorios compartidos de los modales. Ponerlos en `frontend/src/components/modalParts.tsx` y usarlos en los cuatro, para no repetir el markup del overlay.

- [ ] **Step 4: Escribir `DateRangeModal` y `PermisoModal`**

`DateRangeModal` (vacaciones e incapacidad) lleva dos `<input type="date">` y, si el estado es `INCAPACIDAD`, el textarea de justificación con el mismo mínimo. Convierte cada fecha a los extremos del día local:

```tsx
const startIso = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const endIso   = (d: string) => new Date(`${d}T23:59:59.999`).toISOString();
```

Construir el `Date` sin la `Z` hace que el navegador lo interprete en la zona local, que es exactamente lo que se quiere: medianoche local, no medianoche UTC.

`PermisoModal` lleva un `<input type="date">` y dos `<input type="time">`, más el textarea obligatorio. Los dos instantes se arman sobre esa misma fecha, así que el backend nunca recibe un permiso que cruce de día.

- [ ] **Step 5: Cablear en `App.tsx`**

Un solo estado para saber qué modal está abierto:

```tsx
type PendingPick = { status: ResolvedStatus; kind: PayloadKind } | null;
const [pending, setPending] = useState<PendingPick>(null);

const handlePick = (status: ResolvedStatus) => {
  const kind = STATUS_CFG[status].payload;
  if (kind === 'none') { void applyStatus({ status }); return; }
  setPending({ status, kind });
};

const applyStatus = async (payload: StatusPayload) => {
  setActionLoading(true);
  try {
    await setStatus(payload);
    await refresh();
  } catch (e: any) {
    // La lista de ausentes se muestra como alerta clara, no como error genérico.
    const detail = e.detail as StatusError | undefined;
    if (detail?.unavailable?.length) {
      setBlockedParticipants(detail.unavailable);
    } else {
      setError(detail?.errors?.[0]?.message ?? detail?.message ?? 'No se pudo cambiar el estado');
    }
  } finally {
    setActionLoading(false);
    setPending(null);
  }
};
```

Y el renderizado condicional de cada modal según `pending.kind`. Las ausencias (`dateRange`, `permiso`) llaman a `createAbsence` en vez de `setStatus`, y al confirmar muestran qué se registró y desde cuándo aplica:

```tsx
const applyAbsence = async (body: { type: string; startAt: string; endAt: string; justification?: string }) => {
  await createAbsence(body);
  await refresh();
  // El selector hace dos cosas: los estados del día se aplican ya, las
  // ausencias se agendan. Si empieza después de hoy el avatar no cambia
  // todavía, así que hay que decirlo o la persona se queda esperando.
  const starts = new Date(body.startAt);
  const startsLater = starts > new Date();
  setNotice(startsLater
    ? `${cfgOf(body.type).label} registrada del ${fmtDate(body.startAt)} al ${fmtDate(body.endAt)}`
    : `${cfgOf(body.type).label} aplicada`);
  setPending(null);
};
```

- [ ] **Step 6: Verificar que compila**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Probar en el navegador**

Levantar `npm run dev` en `frontend/` y recorrer:
- Disponible se aplica sin modal
- Concentrado abre el modal y el botón dice "Faltan 10 caracteres"
- Escribir 9 caracteres: sigue deshabilitado
- Escribir 10: se habilita, confirma, el estado cambia
- Almuerzo: rango con fin anterior al inicio muestra el error y no deja confirmar
- Vacaciones con fecha futura: aparece el aviso de que se registró y desde cuándo, y el avatar **no** cambia

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ frontend/src/App.tsx
git commit -m "feat(ui): add grouped status selector and payload modals"
```

---

### Task 22: Participantes e invitaciones

**Files:**
- Create: `frontend/src/components/ParticipantPicker.tsx`
- Create: `frontend/src/components/MeetingInviteModal.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `UserSnapshot.isAbsent`, `.status`, `.absenceEndsAt` (Task 17); `listInvites`, `respondInvite`, `leaveMeeting` (Task 20)
- Produces: `ParticipantPicker` con `onConfirm(ids: string[], justification: string)`; `MeetingInviteModal` con `onRespond(id, action)`

- [ ] **Step 1: Escribir `ParticipantPicker`**

Los ausentes salen deshabilitados con el motivo al lado. Es la primera de las dos capas: el backend valida igual, así que la regla no se puede saltar desde la API.

```tsx
export function ParticipantPicker({ users, currentUserId, onClose, onConfirm }: {
  users: UserSnapshot[];
  currentUserId: string;
  onClose: () => void;
  onConfirm: (ids: string[], justification: string) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const missing = Math.max(0, MIN_JUSTIFICATION - text.trim().length);

  const candidates = users.filter(u => u.userId !== currentUserId);

  return (
    <Shell title="En reunión interna" onClose={onClose}>
      <textarea
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        rows={2}
        placeholder="Seguimiento semanal del equipo de cobros"
        className="mb-3 w-full resize-none rounded-xl border border-gray-200 p-2.5 text-xs focus:border-gray-400 focus:outline-none"
      />
      <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-100">
        {candidates.map(u => {
          const cfg = cfgOf(u.status);
          const blocked = u.isAbsent;
          return (
            <label
              key={u.userId}
              className={`flex items-center gap-2.5 px-3 py-2 text-xs ${
                blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                disabled={blocked}
                checked={picked.has(u.userId)}
                onChange={e => {
                  const next = new Set(picked);
                  e.target.checked ? next.add(u.userId) : next.delete(u.userId);
                  setPicked(next);
                }}
              />
              <span className="text-gray-700">{u.firstName} {u.lastName}</span>
              {blocked && (
                <span className={`ml-auto ${cfg.text}`}>
                  {cfg.icon} {cfg.label}
                  {u.absenceEndsAt && ` hasta ${fmtDate(u.absenceEndsAt)}`}
                </span>
              )}
            </label>
          );
        })}
      </div>
      <Actions
        onClose={onClose}
        disabled={missing > 0}
        confirmLabel={missing > 0 ? `Faltan ${missing} caracteres` : `Invitar a ${picked.size}`}
        onConfirm={() => onConfirm([...picked], text.trim())}
      />
    </Shell>
  );
}
```

Se permite confirmar con cero seleccionados: es una reunión interna sin registrar acompañantes, que el backend acepta.

- [ ] **Step 2: Escribir `MeetingInviteModal`**

```tsx
export function MeetingInviteModal({ invite, onRespond }: {
  invite: PendingInvite;
  onRespond: (id: string, action: 'accept' | 'decline') => void;
}) {
  return (
    <Shell title="Te invitaron a una reunión" onClose={() => onRespond(invite.id, 'decline')}>
      <p className="text-xs text-gray-700">
        <span className="font-semibold">{invite.hostName}</span> te invitó a una reunión interna.
      </p>
      {invite.justification && (
        <p className="mt-2 rounded-xl bg-gray-50 p-2.5 text-xs text-gray-600">
          {invite.justification}
        </p>
      )}
      <p className="mt-2 text-[10px] text-gray-400">
        Vence a las {fmtTime(invite.expiresAt)}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={() => onRespond(invite.id, 'decline')}
          className="rounded-xl px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100"
        >
          Rechazar
        </button>
        <button
          onClick={() => onRespond(invite.id, 'accept')}
          className="rounded-xl bg-gray-800 px-3 py-1.5 text-xs font-semibold text-white"
        >
          Aceptar
        </button>
      </div>
    </Shell>
  );
}
```

- [ ] **Step 3: Escuchar el evento de SSE en `App.tsx`**

El stream que ya existe ahora trae eventos dirigidos. Donde se procesan los mensajes:

```tsx
      if (msg.type === 'meeting:invite') {
        void listInvites().then(setInvites);
      }
      if (msg.type === 'meeting:cancelled') {
        setInvites(prev => prev.filter(i => i.meetingId !== msg.meetingId));
        void refresh();
      }
```

Y al montar, cargar las pendientes por si el usuario recargó la página con una invitación viva:

```tsx
  useEffect(() => { void listInvites().then(setInvites); }, []);
```

Se muestra la primera de la cola: `{invites[0] && <MeetingInviteModal invite={invites[0]} onRespond={handleRespond} />}`.

- [ ] **Step 4: Mostrar la alerta de ausentes**

Cuando el backend rechaza por participantes ausentes (el `blockedParticipants` de la Task 21):

```tsx
{blockedParticipants && (
  <Shell title="No se puede invitar a esas personas" onClose={() => setBlockedParticipants(null)}>
    <ul className="space-y-1.5 text-xs text-gray-700">
      {blockedParticipants.map(p => (
        <li key={p.userId} className="flex items-center gap-2">
          <span>{cfgOf(p.reason).icon}</span>
          <span className="font-medium">{p.name}</span>
          <span className={cfgOf(p.reason).text}>
            {cfgOf(p.reason).label}{p.until && ` hasta ${fmtDate(p.until)}`}
          </span>
        </li>
      ))}
    </ul>
  </Shell>
)}
```

- [ ] **Step 5: Verificar que compila**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Probar el flujo completo con dos sesiones**

Hacen falta dos navegadores o dos perfiles, con dos usuarios distintos.

- Usuario A elige En reunión interna, escribe la justificación, selecciona a B, confirma
- A queda en En reunión interna de una, sin esperar respuesta
- A B le aparece el modal de invitación sin recargar
- B acepta: su estado pasa a En reunión interna con la justificación de A
- La tarjeta de A muestra "En reunión con B"
- A cambia a Disponible: B vuelve a Disponible solo
- Repetir y que B rechace: el estado de B no cambia
- Intentar invitar a alguien de vacaciones: aparece la alerta con el nombre y hasta cuándo

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ frontend/src/App.tsx
git commit -m "feat(ui): add participant picker and meeting invite flow"
```

---

### Task 23: Feriados en la interfaz

**Files:**
- Create: `frontend/src/components/HolidayOverrideModal.tsx`
- Create: `frontend/src/components/HolidayAdminPanel.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `listMovableHolidays`, `setHolidayOverride`, `listHolidays`, `createHoliday`, `deleteHoliday` (Task 20)
- Produces: `HolidayOverrideModal` con `onConfirm(holidayId, newDate, justification)`; `HolidayAdminPanel` visible solo con `office.manage`

- [ ] **Step 1: Escribir `HolidayOverrideModal`**

El selector de fecha se limita al mes del feriado elegido, así que el 400 del backend queda como red y no como la única defensa.

```tsx
export function HolidayOverrideModal({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (holidayId: string, newDate: string, justification: string) => void;
}) {
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [holidayId, setHolidayId] = useState('');
  const [newDate, setNewDate] = useState('');
  const [text, setText] = useState('');

  useEffect(() => { void listMovableHolidays().then(setHolidays); }, []);

  const chosen = holidays?.find(h => h.id === holidayId);
  // Mismo mes que el feriado: el backend exige exactamente esto.
  const bounds = chosen ? monthBounds(chosen.date) : null;
  const missing = Math.max(0, MIN_JUSTIFICATION - text.trim().length);
  const ready = !!chosen && !!newDate && missing === 0;

  if (holidays && holidays.length === 0) {
    return (
      <Shell title="Feriado" onClose={onClose}>
        <p className="text-xs text-gray-500">
          No hay feriados disponibles para mover. Ya moviste todos los de tu país,
          o RRHH todavía no cargó el calendario.
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Mover un feriado" onClose={onClose}>
      <select
        value={holidayId}
        onChange={e => { setHolidayId(e.target.value); setNewDate(''); }}
        className="mb-3 w-full rounded-xl border border-gray-200 p-2 text-xs"
      >
        <option value="">Elegí el feriado…</option>
        {holidays?.map(h => (
          <option key={h.id} value={h.id}>{h.name} — {fmtDate(h.date)}</option>
        ))}
      </select>

      {bounds && (
        <DateField
          label="Lo tomo el"
          value={newDate}
          min={bounds.min}
          max={bounds.max}
          onChange={setNewDate}
        />
      )}
      {chosen && (
        <p className="mt-1 text-[10px] text-gray-400">
          Solo se puede mover a otra fecha de {monthName(chosen.date)}.
        </p>
      )}

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={2}
        placeholder="Trabajo el 15 por cierre de mes y lo tomo el 25"
        className="mt-3 w-full resize-none rounded-xl border border-gray-200 p-2.5 text-xs"
      />
      <Actions
        onClose={onClose}
        disabled={!ready}
        confirmLabel={missing > 0 ? `Faltan ${missing} caracteres` : 'Confirmar'}
        onConfirm={() => onConfirm(holidayId, newDate, text.trim())}
      />
    </Shell>
  );
}

function monthBounds(dateIso: string): { min: string; max: string } {
  const d = new Date(`${dateIso.slice(0, 10)}T00:00:00`);
  const y = d.getFullYear(), m = d.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const p = (n: number) => String(n).padStart(2, '0');
  return { min: `${y}-${p(m + 1)}-01`, max: `${y}-${p(m + 1)}-${p(last)}` };
}
```

- [ ] **Step 2: Escribir `HolidayAdminPanel`**

Tabla de feriados con filtro por país y año, formulario de alta y borrado. Reusa el patrón de `BitrixSettings.tsx`, que ya resuelve el envoltorio de panel administrativo y la carga con estado.

El panel se monta solo si el usuario tiene `office.manage`; si no, no se renderiza el botón que lo abre.

- [ ] **Step 3: Cablear en `App.tsx`**

`FERIADO` en el selector abre `HolidayOverrideModal` (su `payload` es `'holidayOverride'`). Al confirmar:

```tsx
const applyHolidayOverride = async (holidayId: string, newDate: string, justification: string) => {
  await setHolidayOverride(holidayId, { newDate, justification });
  await refresh();
  setNotice(`Feriado movido al ${fmtDate(newDate)}`);
  setPending(null);
};
```

- [ ] **Step 4: Verificar que compila**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Probar en el navegador**

- Como admin, cargar el 15 de septiembre para CR desde el panel
- Duplicarlo: muestra el conflicto
- Elegir Feriado en el selector: aparece en la lista de movibles
- El selector de fecha no deja elegir octubre
- Confirmar con fecha del mismo mes: queda registrado
- Volver a abrir Feriado: ese feriado ya no está en la lista
- Sin feriados cargados: el modal explica que RRHH no cargó el calendario

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ frontend/src/App.tsx
git commit -m "feat(ui): add holiday override modal and admin panel"
```

---

### Task 24: Ausentes en el mapa, tarjeta y empaquetado

Cierre de la feature. Hoy el anillo del avatar solo se pinta si `isCheckedIn === true`, así que un ausente se vería gris, idéntico a un desconectado.

**Files:**
- Modify: `frontend/src/components/ZoneTile.tsx`
- Modify: `frontend/src/components/ZoneListView.tsx`
- Modify: `frontend/src/components/HoverCard.tsx`
- Modify: `package.json` y `plugin.json` (versión)

**Interfaces:**
- Consumes: `UserSnapshot.isAbsent`, `.justification`, `.absenceEndsAt`, `.statusEndsAt`, `.meetingWith`; `cfgOf` (Task 19)
- Produces: el `.vla.zip` de la versión 1.1.0

- [ ] **Step 1: Pintar el anillo de los ausentes**

En `ZoneTile.tsx`, la condición del anillo:

```tsx
  // Un ausente tiene isCheckedIn en false pero igual se pinta: si no, se vería
  // gris, idéntico a un desconectado.
  const ringColor = (u.isCheckedIn || u.isAbsent) ? cfgOf(u.status).color : undefined;
```

Y el pulso de `AVAILABLE` solo aplica a quien está presente de verdad:

```tsx
  {u.isCheckedIn && !u.isAbsent && u.status === 'AVAILABLE' && ( /* animate-ping */ )}
```

El ícono de la ausencia va como distintivo en la esquina del avatar:

```tsx
  {u.isAbsent && cfgOf(u.status).icon && (
    <span className="absolute -bottom-0.5 -right-0.5 text-[9px] leading-none">
      {cfgOf(u.status).icon}
    </span>
  )}
```

El conteo de la zona sigue midiendo presencia real, no incluye ausentes:

```tsx
  const online = users.filter(u => u.isCheckedIn && !u.isAbsent);
```

- [ ] **Step 2: Repetir en `ZoneListView.tsx`**

Mismos tres cambios. El archivo ya tiene su propia lógica de `ringColor` y del `animate-ping` de `AVAILABLE`, además del `HoverCard` por tap que se agregó para móvil.

- [ ] **Step 3: Ampliar `HoverCard`**

Tres bloques nuevos, sobre los helpers `formatTime` y `duration` que el archivo ya tiene:

```tsx
      {/* Justificación: solo llega si el viewer tiene permiso. */}
      {user.justification && (
        <p className="mt-1.5 rounded-lg bg-gray-50 px-2 py-1.5 text-[11px] leading-snug text-gray-600">
          {user.justification}
        </p>
      )}

      {/* Cuándo vuelve, en ausencias con rango. */}
      {user.absenceEndsAt && (
        <p className="mt-1 text-[10px] text-gray-400">
          Vuelve el {new Date(user.absenceEndsAt).toLocaleDateString('es', { day: 'numeric', month: 'long' })}
        </p>
      )}

      {/* Almuerzo: el rango es informativo y no se revierte solo, así que el
          vencimiento se marca acá. También hace visible quién se pasa. */}
      {user.status === 'LUNCH' && user.statusEndsAt && (
        <p className="mt-1 text-[10px]">
          {new Date(user.statusEndsAt) < new Date()
            ? <span className="text-orange-500">⚠ Venció {duration(user.statusEndsAt)} atrás</span>
            : <span className="text-gray-400">Hasta {formatTime(user.statusEndsAt)}</span>}
        </p>
      )}

      {/* Con quién está reunido. */}
      {user.meetingWith?.length ? (
        <p className="mt-1 text-[10px] text-gray-400">
          Con {user.meetingWith.map(p => p.firstName).join(', ')}
        </p>
      ) : null}
```

- [ ] **Step 4: Subir la versión**

La versión sigue en 1.0.0 desde abril, pese a todo el trabajo responsive que ya está en `main`. Esta feature justifica el salto.

En `package.json`, `frontend/package.json` y `plugin.json`: `"version": "1.1.0"`.

- [ ] **Step 5: Correr la suite completa y los dos builds**

```bash
npm test
npx tsc --noEmit
cd frontend && npx tsc --noEmit && cd ..
```

Expected: las tres pasan. `npm test` cubre los 7 archivos de `src/lib/`.

- [ ] **Step 6: Empaquetar**

```bash
npm run release
unzip -l office-1.1.0.vla.zip | head -20
```

Expected: el zip existe, con `plugin.json` en versión 1.1.0, `dist/` y `ui/`.

**Antes de instalar:** el `.vla.zip` que hay hoy en el repo (`office-1.0.0.vla.zip`) no corresponde al último commit — se construyó a las 13:25 del 17 de abril, casi dos horas después del commit de las 11:30, e incluye el cambio de `HoverCard` para móvil que está sin commitear. Commitear o descartar ese pendiente antes de empaquetar, o el zip nuevo vuelve a arrastrar cambios que no están en git.

- [ ] **Step 7: Instalar y hacer la pasada final**

```bash
npm run dev   # compila e instala en el core local
```

Recorrido completo en el navegador:
- Los 10 estados aparecen en el selector, agrupados en Día y Ausencia
- Desconectado **no** aparece en el selector
- Un compañero de vacaciones se ve con anillo celeste y 🏖, no gris
- Su tarjeta dice cuándo vuelve
- Una incapacidad ajena no muestra el texto de la justificación
- La misma incapacidad, vista por un admin, sí lo muestra
- Un almuerzo con hora vencida muestra el aviso naranja
- El mapa y la vista de lista pintan igual

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ package.json frontend/package.json plugin.json \
        frontend/dist ui office-1.1.0.vla.zip
git commit -m "feat(ui): show absent users on the map, extend hover card, bump to 1.1.0"
```

---

## Deploy

El orden no es negociable. El plugin escribe estados que el enum viejo rechaza, así que si sube primero, rompe.

1. **Respaldo.** `pg_dump` de `virtual_office."PresenceStatus"`. La migración pierde qué filas eran `BUSY` y `rollback.sql` no lo recupera.
2. **Core.** Desplegar `vla-system`, correr `npx prisma migrate deploy`, reiniciar el API.
3. **Verificar.** `SELECT unnest(enum_range(NULL::virtual_office."OfficeStatus"))` devuelve los 7 valores nuevos.
4. **Plugin.** Subir `office-1.1.0.vla.zip` desde la pantalla de plugins.
5. **Organigrama.** `POST /org/sync`. Anotar `synced`, `heads` y `withCountry`. Si `withCountry` es bajo, cargar overrides de país; si `heads` es 0, la visibilidad por jefe directo no funciona hasta que RRHH llene `UF_HEAD` en Bitrix o se carguen overrides.
6. **Feriados.** RRHH carga el calendario por país. Arranca vacío a propósito: el set correcto depende de en qué países tiene gente VLA, y eso lo define RRHH.
7. **Vigilar el cron.** Revisar el log del sync de timeman durante 10 minutos. `skippedByAbsence` tiene que aparecer en cuanto haya una ausencia registrada; si sale 0 con ausencias activas, el blindaje no está funcionando y hay que revertir antes de que borre estados.

**Reversa:** bajar el plugin a `office-1.0.0.vla.zip`, correr `rollback.sql` con `psql`, restaurar `PresenceStatus` del respaldo si se necesitan los valores originales, y desplegar el commit anterior del core.

## Cobertura del spec

| Sección del spec | Tareas |
|---|---|
| Estados del día | 2, 6, 19, 21 |
| Ausencias | 3, 7, 12, 21 |
| Feriado y override | 3, 8, 13, 23 |
| Esquema y modelos | 2, 3 |
| Modelos en el SDK del plugin | 4 |
| Resolución del estado visible | 9, 17 |
| Cambios en `UserSnapshot` | 17, 20 |
| Blindaje del cron | 18 |
| Visibilidad de justificaciones | 10, 17, 12 |
| Jefe directo y país | 14 |
| Invitaciones a reunión | 11, 15, 22 |
| No invitable estando ausente | 16, 22 |
| API y validación | 12, 13, 14, 15, 16 |
| Permisos | 4, 16 |
| Zona horaria | 5 |
| Migración de datos | 2 |
| Configuración unificada de estados | 19 |
| Ausencias como grupo visual | 19, 24 |
| El selector hace dos cosas | 21 |
| Componentes del frontend | 21, 22, 23, 24 |
| Core (`shared`, `apps/web`) | 4 |
| Riesgos | 2 (respaldo), 14 (medición), 18 (contador), 5 (zona), Deploy |
| Pruebas | 5–11 unitarias; 12–18 con curl; 21–24 en navegador |

Fuera de alcance según el spec, sin tarea a propósito: aprobaciones, adjuntos, auto-revertir el almuerzo, reportes de ausencias, saldo de vacaciones y notificaciones push.
