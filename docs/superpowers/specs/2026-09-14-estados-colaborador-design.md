# Rediseño de estados de colaborador — vla-plugin-office

Fecha: 2026-09-14
Estado: diseño aprobado, pendiente plan de implementación

## Problema

El plugin tiene hoy 7 estados planos (`AVAILABLE`, `BUSY`, `IN_MEETING`, `FOCUS`,
`LUNCH`, `BRB`, `OFFLINE`). Ninguno exige respaldo: el colaborador elige y
listo. No hay forma de saber por qué alguien está en un estado, ni de registrar
ausencias reales (vacaciones, incapacidad, permiso, feriado), ni de reportar
sobre ellas.

El rediseño pide 10 estados, de los cuales 7 exigen información de respaldo y 4
son ausencias que duran más de un día.

## Decisiones de diseño

Cada decisión con su razón, para que no se re-litigue durante la implementación.

| Decisión | Razón |
|---|---|
| Las ausencias van en tabla aparte con rango de fechas, no en `PresenceStatus.status` | Permite registro anticipado, sobrevive al cron de Bitrix, y da historial reportable. Una sola fila por usuario no puede guardar "vacaciones la semana entrante". |
| Sin flujo de aprobación | La justificación queda en bitácora para que supervisión la revise después. Evita rol supervisor, pantalla de solicitudes y estado PENDIENTE. |
| Sin adjuntos | La justificación en texto basta (`"Boleta CCSS 4477-2026, 10–14 oct"`). Evita storage, límites de tamaño y control de descarga de datos médicos. |
| Reunión interna por invitación que el invitado acepta | Nadie escribe sobre el estado de otro. Evita decidir qué pasa si el invitado estaba de vacaciones. |
| Almuerzo vencido no se revierte solo | Sin cron de expiración. El rango es informativo y la UI marca el vencimiento, lo que además hace visible quién se pasa. |
| Estados nuevos en el enum del core, no en schema propio del plugin | Una sola fuente de verdad para el estado del día. Costo aceptado: deploy coordinado de `vla-system` + plugin. |
| `OfficeStatus` en inglés, `AbsenceType` en español, etiquetas siempre en español | `OfficeStatus` ya existe en inglés y lo consume el core; renombrarlo tocaría todas las filas. `AbsenceType` es nuevo y usa la terminología de negocio. |
| Jefe directo y país: se extraen de Bitrix, con override manual desde el plugin | Bitrix tiene el organigrama real y no hay que mantenerlo, pero los campos vienen mal llenados o vacíos y hace falta corregirlos. |
| Feriado no es un tipo de ausencia | RRHH carga el calendario por país; el colaborador solo puede mover un feriado a otra fecha del mismo mes. Es un mecanismo distinto al de pedir un permiso. |

## Estados

### Estados del día — `PresenceStatus.status`

| Etiqueta | Enum | Payload | Justif. | Justif. visible para |
|---|---|---|---|---|
| Disponible | `AVAILABLE` | — | no | — |
| Concentrado | `FOCUS` | — | **sí** | todos |
| En reunión interna | `IN_MEETING_INTERNAL` | participantes | **sí** | todos |
| En reunión externa | `IN_MEETING_EXTERNAL` | — | **sí** | todos |
| Vuelvo pronto | `BRB` | — | **sí** | todos |
| Almuerzo | `LUNCH` | hora inicio + fin | no | — |
| Desconectado | `OFFLINE` | — | solo sistema | — |

`BUSY` e `IN_MEETING` se eliminan.

### Ausencias — `AbsenceRecord`

| Etiqueta | Enum | Duración | Justif. | Justif. visible para |
|---|---|---|---|---|
| Permiso | `PERMISO` | una fecha + hora inicio/fin | **sí** | dueño, jefe directo, `office.manage` |
| Vacaciones | `VACACIONES` | rango de fecha | no | — |
| Incapacidad | `INCAPACIDAD` | rango de fecha | **sí** | dueño, jefe directo, `office.manage` |

### Feriado — `Holiday` + `HolidayOverride`

No es un `AbsenceType`. Se deriva del calendario que carga RRHH, cruzado con el
país del colaborador. Etiqueta: `FERIADO`. Justificación (la del override)
visible para todos.

## Esquema — core, schema `virtual_office`

```prisma
enum OfficeStatus {
  AVAILABLE
  IN_MEETING_INTERNAL   // nuevo
  IN_MEETING_EXTERNAL   // nuevo
  FOCUS
  LUNCH
  BRB
  OFFLINE
}

model PresenceStatus {
  // ── campos actuales, sin cambios ──
  id             String       @id @default(uuid())
  userId         String       @unique
  status         OfficeStatus @default(OFFLINE)
  statusMessage  String?
  currentZoneId  String?
  defaultZoneId  String?
  positionX      Int?
  positionY      Int?
  isCheckedIn    Boolean      @default(false)
  lastActivityAt DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  // ── nuevos ──
  justification  String?      // respalda el estado del día
  statusStartsAt DateTime?    // LUNCH: hora de inicio
  statusEndsAt   DateTime?    // LUNCH: hora de fin
  meetingId      String?      // agrupa host + participantes aceptados

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@schema("virtual_office")
}

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
  startAt       DateTime    // PERMISO lleva hora; los otros 00:00:00 hora local
  endAt         DateTime    // PERMISO lleva hora; los otros 23:59:59 hora local
  justification String?     // obligatoria en PERMISO e INCAPACIDAD
  createdBy     String      // quién registró (puede ser RRHH por el colaborador)
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
  country String   // ISO 3166-1 alpha-2: "CR", "NI", "PA", ...

  overrides HolidayOverride[]

  @@unique([date, country])
  @@index([country, date])
  @@schema("virtual_office")
}

model HolidayOverride {
  id            String   @id @default(uuid())
  userId        String
  holidayId     String
  newDate       DateTime @db.Date  // debe caer en el mismo mes que Holiday.date
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

// Corrige lo que viene mal o vacío de Bitrix. Una fila por usuario;
// los campos en null significan "usar el valor de Bitrix".
model UserProfileOverride {
  id            String  @id @default(uuid())
  userId        String  @unique
  managerUserId String?
  country       String?

  @@schema("virtual_office")
}

model BitrixUserMapping {
  // ── campos actuales ──
  // ── nuevos, poblados por el cron de sincronización ──
  departmentId     String?
  isDepartmentHead Boolean @default(false)
  country          String?
}
```

### Modelos nuevos y el cliente Prisma del plugin

`ctx.prisma` es un `PluginPrismaClient` restringido: solo expone los modelos que
el plugin declaró. Los cinco modelos nuevos (`AbsenceRecord`, `Holiday`,
`HolidayOverride`, `MeetingInvite`, `UserProfileOverride`) hay que exponerlos en
los tipos del SDK y mapearlos a permisos nuevos:

- `read:absences` / `write:absences` → `AbsenceRecord`
- `read:holidays` / `write:holidays` → `Holiday`, `HolidayOverride`
- `read:meetings` / `write:meetings` → `MeetingInvite`
- `read:org` / `write:org` → `UserProfileOverride`

Se declaran en `plugin.json` bajo `permissions`.

## Resolución del estado visible

Las ausencias y los feriados no se escriben nunca en `PresenceStatus.status`.
El estado que ve la oficina se calcula al momento de componer el snapshot:

```
estadoVisible(usuario, ahora):
  1. ¿AbsenceRecord con startAt <= ahora <= endAt?
       → PERMISO | VACACIONES | INCAPACIDAD
  2. ¿Feriado efectivo hoy?
       → FERIADO
  3. → PresenceStatus.status
```

**Feriado efectivo hoy** se resuelve así:

```
feriadoEfectivo(usuario, hoy):
  a. ¿HolidayOverride del usuario con newDate == hoy?          → sí
  b. ¿Holiday(date == hoy, country == país del usuario)?
       y el usuario NO tiene override para ese Holiday         → sí
  c. → no
```

El punto (b) es lo que hace funcionar el override: si el colaborador movió el
feriado, ese día trabaja normal y el feriado le cae en `newDate`.

Si una ausencia se solapa con un feriado, gana la ausencia — el paso 1 corre
primero. Una incapacidad que cae en feriado se lee como incapacidad, que es lo
correcto para efectos de registro.

Va en `SnapshotService.getAll()` ([snapshot.service.ts:37](../../../src/services/snapshot.service.ts#L37)), el único
punto donde se compone el snapshot.

### Cambios en `UserSnapshot`

```ts
export interface UserSnapshot {
  // ...campos actuales...
  status:          string;    // el estado resuelto, ya incluye ausencias y feriado
  rawStatus:       string;    // PresenceStatus.status sin resolver, para depurar
  isAbsent:        boolean;   // el estado viene de una ausencia o feriado
  justification?:  string;    // omitido si el viewer no tiene permiso
  statusStartsAt?: string;
  statusEndsAt?:   string;
  absenceEndsAt?:  string;    // "vuelve el 20 de octubre"
  meetingId?:      string;
  meetingWith?:    { userId: string; firstName: string; lastName: string }[];
}
```

`isAbsent` existe porque hoy la UI solo pinta el anillo de color cuando
`isCheckedIn === true`, y una persona de vacaciones tiene `isCheckedIn: false`.
Sin este campo el ausente se vería gris, idéntico a un desconectado.

## Blindaje del cron de Bitrix

Sin esto la feature no funciona. `runTimemanSync` corre cada 2 minutos
([index.ts:307](../../../src/index.ts#L307)) y manda a `OFFLINE` a cualquiera con
timeman cerrado. Quien está de vacaciones tiene timeman cerrado, así que el
sistema le borraría el estado cada 2 minutos.

Dos puntos a blindar:

1. `runTimemanSync` — se salta a cualquier usuario con ausencia activa o feriado
   efectivo hoy. Se suma al chequeo de `hasManualOverride` que ya existe, y se
   cuenta aparte en el log (`skippedByAbsence`) para poder diagnosticar.
2. Auto-checkout por inactividad de 8h ([index.ts:255](../../../src/index.ts#L255)) —
   mismo blindaje. No tiene sentido "cerrar por inactividad" a quien está de
   incapacidad.

Para no pegarle a la base una vez por usuario, el blindaje carga de una sola
consulta el set de `userId` con ausencia o feriado activo antes de entrar al
ciclo.

## Visibilidad de justificaciones

`SnapshotService.getAll()` pasa a `getAll(viewerId)`. Cambio de interfaz; todos
los llamadores hay que actualizarlos.

```
puedeVerJustificacion(viewer, target, estadoResuelto):
  estado público (FOCUS, IN_MEETING_INTERNAL,
                  IN_MEETING_EXTERNAL, BRB, FERIADO)  → sí
  viewer.id === target.id                             → sí
  viewer tiene permiso office.manage                  → sí
  viewer es jefe directo de target                    → sí
  resto                                               → no
```

Cuando da `no`, el backend **omite el campo** de la respuesta. No se manda vacío
ni se oculta en el frontend: el texto nunca viaja al cliente sin permiso. Aplica
también a `GET /absences` de otra persona.

### Jefe directo y país

Los dos se resuelven igual, con el override ganando:

```
jefeDirecto(usuario) =
  UserProfileOverride.managerUserId
  ?? usuario VLA cuyo bitrixId == UF_HEAD del departamento Bitrix del usuario
  ?? ninguno

pais(usuario) =
  UserProfileOverride.country
  ?? BitrixUserMapping.country
  ?? DEFAULT_COUNTRY (setting del plugin, arranca en "CR")
```

`DEFAULT_COUNTRY` existe porque `PERSONAL_COUNTRY` viene vacío en buena parte de
los usuarios de Bitrix. Sin ese respaldo esa gente no recibiría ningún feriado.
La primera tarea de implementación mide cuántos usuarios lo tienen lleno, y el
resultado decide si hace falta una carga inicial de overrides.

`BitrixService` suma:

```ts
// SELECT de user.get pasa a incluir UF_DEPARTMENT y PERSONAL_COUNTRY
async syncOrgStructure(): Promise<{ synced: number; heads: number }>
  // department.get  → UF_HEAD por departamento
  // user.get        → UF_DEPARTMENT, PERSONAL_COUNTRY por usuario
  // escribe BitrixUserMapping.departmentId / isDepartmentHead / country
```

Corre en el cron de 6 horas que ya existe para fotos, no en uno nuevo.
`PERSONAL_COUNTRY` en Bitrix es un ID numérico de país, no un ISO: hace falta
una tabla de conversión a ISO alpha-2 en el servicio, con los países donde VLA
tiene gente. Si llega un ID desconocido se registra en el log y cae al
`DEFAULT_COUNTRY`.

## Invitaciones a reunión interna

```
Host elige IN_MEETING_INTERNAL + justificación + [Beto, Carla]
  → meetingId nuevo
  → 1 MeetingInvite PENDING por invitado
  → SSE "meeting:invite" a cada invitado
  → el host queda en IN_MEETING_INTERNAL de una, sin esperar respuesta

Beto acepta   → status = IN_MEETING_INTERNAL
                justification y meetingId heredados del host
                invite = ACCEPTED
Carla rechaza → sin cambio de estado, invite = DECLINED
Nadie responde en 15 min → invite = EXPIRED, sin cambio de estado

Host cambia a otro estado:
  → los PENDING pasan a CANCELLED
  → los ACCEPTED vuelven a AVAILABLE y se les limpia justification y meetingId

Beto se sale solo:
  → cambia su estado por su cuenta; se le limpia meetingId
  → el meeting sigue con el host y el resto
```

### No se puede invitar a quien está ausente

Vacaciones, incapacidad y permiso activos bloquean la invitación. Aplica a las
tres, no solo a las dos que se nombraron en la conversación: un permiso activo
también significa que la persona no está.

Dos capas:

1. **Selector de usuarios** — los ausentes salen deshabilitados con el motivo al
   lado (`Beto Pérez · Vacaciones hasta el 20 oct`). No se pueden marcar.
2. **Backend** — `PATCH /presence/status` con `participantIds` valida igual y
   devuelve `400` nombrando a quién no se puede invitar y por qué. La validación
   del backend no es redundante: sin ella la regla se salta llamando la API
   directo.

```json
{
  "message": "No se puede invitar a colaboradores ausentes",
  "unavailable": [
    { "userId": "…", "name": "Beto Pérez", "reason": "VACACIONES", "until": "2026-10-20" }
  ]
}
```

El frontend muestra ese detalle como alerta clara al que invita, no un error
genérico.

## Feriados

- **Carga**: RRHH mantiene `Holiday` por país. Requiere `office.manage`. El
  calendario arranca vacío; no se precargan feriados en la migración porque el
  set correcto depende de los países donde VLA tenga gente y eso lo define RRHH.
- **Automático**: si hoy hay un `Holiday` del país del colaborador y no tiene
  override para ese feriado, aparece en `FERIADO`. Sin justificación, sin que
  haga nada.
- **Override**: el colaborador mueve un feriado a otra fecha, con justificación
  obligatoria. `newDate` debe caer en el **mismo mes calendario** que
  `Holiday.date`; si no, `400`. Un feriado solo se puede mover una vez
  (`@@unique([userId, holidayId])`).

## API

```
PATCH  /presence/status
       { status, justification?, startsAt?, endsAt?, participantIds? }

POST   /absences                    { type, startAt, endAt, justification? }
GET    /absences?userId&from&to
DELETE /absences/:id

GET    /meetings/invites            pendientes del viewer
POST   /meetings/invites/:id/accept
POST   /meetings/invites/:id/decline

GET    /holidays?year&country
POST   /holidays                    office.manage
DELETE /holidays/:id                office.manage
POST   /holidays/:id/override       { newDate, justification }
DELETE /holidays/:id/override

GET    /org/:userId                 jefe y país resueltos
PUT    /org/:userId                 office.manage — escribe UserProfileOverride
```

### Validación

`PATCH /presence/status` hoy no valida nada: [index.ts:83](../../../src/index.ts#L83)
hace `status as any` directo al servicio, así que se puede escribir cualquier
string a la base. Se corrige acá porque el rediseño toca ese endpoint y sin
validación las reglas nuevas no se sostienen.

Reglas, todas con `400`:

- `status` tiene que ser miembro de `OfficeStatus`.
- `justification` obligatoria y de 10 caracteres o más, ya recortada, en `FOCUS`,
  `IN_MEETING_INTERNAL`, `IN_MEETING_EXTERNAL` y `BRB`. El mínimo existe para que
  no se escriba `"."`; si resulta molesto en la práctica se baja, pero se arranca
  exigiendo algo legible.
- `OFFLINE` no se puede pedir desde la API. Lo escribe solo el sistema.
- `LUNCH` exige `startsAt` y `endsAt`, con `endsAt > startsAt`, los dos el mismo día.
- `participantIds` solo se acepta con `IN_MEETING_INTERNAL`, no puede incluir al
  propio host, y ninguno puede estar ausente.
- `AbsenceRecord`: `endAt > startAt`. `PERMISO` tiene que empezar y terminar el
  mismo día. `VACACIONES` e `INCAPACIDAD` cubren días completos. `justification`
  obligatoria y de 10 caracteres o más en `PERMISO` e `INCAPACIDAD`.
- Ausencias solapadas del mismo usuario: `409` con el registro que choca.

### Permisos

Cambiar el propio estado pasa a exigir `office.checkin` en vez de `office.view`.
`office.checkin` está declarado en `plugin.json` desde el inicio y hoy no lo usa
ningún endpoint; `office.view` debería ser solo de lectura.

- `office.view` — leer el snapshot y el calendario de feriados
- `office.checkin` — check-in/out, cambiar el propio estado, registrar las
  propias ausencias, mover los propios feriados, responder invitaciones
- `office.manage` — cargar feriados, escribir overrides de jefe y país, ver
  justificaciones restringidas de cualquiera, registrar ausencias de otros

### Zona horaria

El API y Postgres corren en UTC mientras la operación es UTC-6. Un bug de este
tipo ya se dio en el plugin de cobros: las fechas se corrían a partir de las
18:00 hora local.

Reglas para este diseño:

- `Holiday.date` y `HolidayOverride.newDate` son `@db.Date`, sin hora ni zona.
- "Hoy" para resolver feriados se calcula en la zona de la operación, no en UTC.
- `AbsenceRecord` de día completo se guarda como 00:00:00 y 23:59:59 **hora
  local convertida a UTC**, no 00:00Z.
- La validación de "mismo mes" del override compara meses en hora local.

La zona sale de un setting del plugin (`TIMEZONE`, arranca en
`America/Costa_Rica`), no de la zona del proceso.

## Migración de datos

Postgres no permite quitar valores de un enum en caliente, y `db:push` — el
único script que expone `apps/api/package.json` — fallaría o exigiría
`--accept-data-loss`. Hace falta una migración Prisma escrita a mano, y el orden
importa:

```sql
-- 1. Sacar las filas de los valores que se eliminan.
--    Ambos van a AVAILABLE, no a CONCENTRADO ni a EN_REUNION_EXTERNA:
--    esos dos exigen justificación y las filas viejas no tienen, así que
--    mapearlas ahí crearía registros que violan su propia regla.
--    Son estados del día que el cron reescribe en 2 minutos; no se pierde nada.
UPDATE virtual_office."PresenceStatus"
   SET status = 'AVAILABLE'
 WHERE status IN ('BUSY', 'IN_MEETING');

-- 2. Recrear el tipo. El DEFAULT se suelta antes de cambiar el tipo
--    y se vuelve a poner después.
ALTER TYPE virtual_office."OfficeStatus" RENAME TO "OfficeStatus_old";

CREATE TYPE virtual_office."OfficeStatus" AS ENUM (
  'AVAILABLE', 'IN_MEETING_INTERNAL', 'IN_MEETING_EXTERNAL',
  'FOCUS', 'LUNCH', 'BRB', 'OFFLINE'
);

ALTER TABLE virtual_office."PresenceStatus"
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE virtual_office."OfficeStatus"
    USING status::text::virtual_office."OfficeStatus",
  ALTER COLUMN status SET DEFAULT 'OFFLINE';

DROP TYPE virtual_office."OfficeStatus_old";

-- 3. Tablas y enums nuevos (AbsenceRecord, Holiday, HolidayOverride,
--    MeetingInvite, UserProfileOverride, AbsenceType, InviteState)
--    y columnas nuevas en PresenceStatus y BitrixUserMapping.
```

El `down.sql` revierte el tipo al set anterior y manda
`IN_MEETING_INTERNAL` e `IN_MEETING_EXTERNAL` a `IN_MEETING`. No puede recuperar
qué filas eran `BUSY`: la migración hacia adelante pierde ese dato. Aceptable
para un estado transitorio, pero hay que decirlo antes de correrla en producción.

## Frontend

### Configuración de estados unificada

Los colores de estado están duplicados en tres archivos:
`STATUS_CFG` en [App.tsx:18](../../../frontend/src/App.tsx#L18), `STATUS_RING` en
`ZoneTile.tsx` y `STATUS_RING` otra vez en
[ZoneListView.tsx:6](../../../frontend/src/components/ZoneListView.tsx#L6). Con 7
estados ya se desincronizan; con 11 es seguro que pase.

Se unifican en `frontend/src/statusConfig.ts`, fuente única de etiqueta, color,
ícono, si exige justificación y qué payload pide.

### Ausencias como grupo visual

Los estados del día usan color saturado; las ausencias usan tono apagado más un
ícono. Así se leen como dos grupos distintos sin tener que inventar cuatro
matices más que nadie distingue.

| Estado | Color | Ícono |
|---|---|---|
| Disponible | `#4ade80` | — |
| Concentrado | `#60a5fa` | — |
| En reunión interna | `#c084fc` | — |
| En reunión externa | `#7c3aed` | — |
| Almuerzo | `#fb923c` | — |
| Vuelvo pronto | `#facc15` | — |
| Desconectado | `#d1d5db` | — |
| Permiso | `#94a3b8` | 📄 |
| Vacaciones | `#7dd3fc` | 🏖 |
| Incapacidad | `#fca5a5` | 🏥 |
| Feriado | `#fcd34d` | 🎉 |

Interna y externa comparten familia de morado a propósito: son la misma clase de
cosa con distinto sabor.

El anillo se pinta cuando `isCheckedIn === true` **o** `isAbsent === true`. Hoy
solo mira `isCheckedIn`, y sin ese cambio el ausente se vería gris.

### El selector hace dos cosas

Elegir un estado del día lo aplica de inmediato. Elegir una ausencia crea un
registro con fechas, que puede empezar hoy o en dos semanas — en ese caso el
estado visible **no cambia ahora**.

Si no se distingue, el colaborador elige Vacaciones para noviembre y se queda
esperando que el avatar cambie. Después de guardar una ausencia que empieza
después de hoy, la confirmación dice qué se registró y desde cuándo aplica
(`Vacaciones registradas del 3 al 14 de noviembre`), y el estado del día se
queda como estaba.

### Componentes

- `StatusSelector` — 10 opciones en dos grupos. Día: Disponible, Concentrado,
  En reunión interna, En reunión externa, Almuerzo, Vuelvo pronto. Ausencia:
  Permiso, Vacaciones, Feriado, Incapacidad. `Desconectado` no aparece: lo
  escribe solo el sistema y la API lo rechaza. Ya soporta `dropUp` para móvil.
- `JustificationModal` — se abre al elegir un estado que la exige. El botón de
  confirmar queda deshabilitado con menos de 10 caracteres, y dice cuántos
  faltan en vez de solo estar apagado.
- `TimeRangeModal` — Almuerzo, hora inicio y fin.
- `DateRangeModal` — Vacaciones e Incapacidad, fecha inicio y fin.
- `PermisoModal` — una fecha más hora inicio y fin.
- `HolidayOverrideModal` — al elegir Feriado. Lista los feriados del país del
  colaborador que todavía no movió, se escoge uno, se elige `newDate` con el
  selector limitado al mismo mes que el feriado, y se escribe la justificación.
  Si no hay feriados disponibles para mover, la opción sale deshabilitada en el
  selector con el motivo.
- `ParticipantPicker` — reunión interna. Los ausentes salen deshabilitados con el
  motivo.
- `MeetingInviteModal` — invitación entrante, Aceptar o Rechazar, con quién
  invita y su justificación.
- `HoverCard` — estado, justificación si hay permiso, `vuelve el 20 oct` en
  ausencias, y `⚠ venció hace 30 min` cuando pasó el fin del almuerzo.
- `HolidayAdminPanel` — CRUD de feriados por país, con `office.manage`. Reusa el
  patrón de `BitrixSettings.tsx`.

### Core

- `packages/shared/src/types/office.types.ts` — el enum compartido
- `apps/web/src/lib/utils.ts` — `STATUS_CONFIG` es un `Record<PresenceStatusEnum, …>`
  exhaustivo: revienta el build hasta que se actualice
- `apps/web/src/hooks/usePresence.ts` — firma de `changeStatus`

## Fuera de alcance

Descartado en el diseño, con su razón:

- **Aprobaciones** — la justificación queda en bitácora y supervisión la revisa
  después.
- **Adjuntos** (boleta CCSS, dictamen) — el texto de la justificación basta y el
  documento sigue circulando fuera del sistema.
- **Auto-revertir el almuerzo vencido** — el rango es informativo y el
  vencimiento se marca en la UI.
- **Reportes y dashboard de ausencias** — los datos quedan modelados para
  soportarlos después.
- **Saldo de días de vacaciones** — exige política de acumulación y fecha de
  ingreso de cada colaborador; es su propia feature.
- **Notificaciones push** — la invitación llega por el SSE que ya existe.
  `PushSubscription` está en el core para cuando se quiera.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Deploy coordinado de dos repos. Si el plugin sube antes del core, escribe estados que el enum no acepta | El plugin valida `vlaMinVersion`. Orden: primero migración del core, después el `.vla.zip`. Documentar el rollback de las dos piezas. |
| El rollback de la migración no recupera los `BUSY` | Respaldo de `PresenceStatus` antes de migrar. Avisar que el dato se pierde. |
| `PERSONAL_COUNTRY` vacío en Bitrix deja gente sin feriados | Respaldo con `DEFAULT_COUNTRY`. La primera tarea mide cuántos lo tienen lleno. |
| `UF_HEAD` mal puesto deja a alguien viendo justificaciones que no le tocan, o sin verlas | Override manual desde el plugin. La resolución de jefe se prueba con casos reales antes de soltar la visibilidad restringida. |
| El blindaje del cron se rompe y borra estados de ausencia cada 2 min | Contador `skippedByAbsence` en el log del sync, y prueba de regresión con un usuario de vacaciones y timeman cerrado. |
| Corrimiento de fechas por UTC vs UTC-6 | Setting `TIMEZONE`, `@db.Date` en feriados, pruebas con hora local 18:00–23:59. |
| El mínimo de 10 caracteres provoca justificaciones basura tipo `"aaaaaaaaaa"` | Es un piso, no una garantía. Los reportes de supervisión son el control real. |

## Pruebas

**Resolver**
- Ausencia activa gana sobre `PresenceStatus.status`
- Feriado gana sobre `PresenceStatus.status`
- Ausencia gana sobre feriado cuando se solapan
- Ausencia que ya venció no gana
- Ausencia futura no gana
- Feriado de otro país no aplica
- Con override, no hay feriado en la fecha original y sí en `newDate`

**Cron**
- Usuario con vacaciones activas y timeman cerrado sigue en `VACACIONES` después
  de correr el sync
- Igual con feriado efectivo hoy
- El auto-checkout de 8h no toca a quien está ausente
- Usuario sin ausencia sigue sincronizando como antes: sin regresión

**Visibilidad** — matriz de viewer × estado
- Dueño, jefe directo, `office.manage` y un tercero cualquiera
- Contra estado público y estado restringido
- El caso del tercero verifica que el campo **no está** en el JSON, no que venga
  vacío
- El jefe resuelto por override y el jefe resuelto por Bitrix, los dos

**Invitaciones**
- Aceptar hereda justificación y `meetingId`
- Rechazar no cambia el estado
- El `PENDING` vence a los 15 min y no se aplica
- El host cambia de estado: los `PENDING` quedan `CANCELLED` y los `ACCEPTED`
  vuelven a `AVAILABLE`
- El invitado se sale solo; el meeting sobrevive
- Invitar a alguien ausente da `400` con el detalle
- El host no puede invitarse a sí mismo

**Validación**
- `400` sin justificación en cada uno de los cuatro estados que la exigen
- `400` con justificación de 9 caracteres; pasa con 10
- `400` pidiendo `OFFLINE` desde la API
- `400` con un `status` que no existe en el enum (es el bug de hoy)
- `400` en `LUNCH` sin rango, y con `endsAt <= startsAt`
- `400` en override de feriado con `newDate` en otro mes
- `409` con ausencias solapadas
- `403` cambiando el estado con solo `office.view`

**Migración**
- `up` con filas reales en `BUSY` e `IN_MEETING`: las dos quedan en `AVAILABLE`
- `down` devuelve el tipo al set anterior
- El `DEFAULT` de la columna sobrevive el cambio de tipo

**Zona horaria**
- Resolver feriados a las 18:00, 20:00 y 23:30 hora local: sigue dando el mismo
  día
- Ausencia de día completo creada a las 23:00 hora local cubre el día correcto
