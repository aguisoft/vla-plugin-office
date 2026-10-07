# Solicitudes de ausencia con aprobación del jefe

Fecha: 2026-10-07 · Plugin: office · Estado: propuesta

## Problema

Hoy una ausencia (permiso, cita médica, vacaciones, incapacidad) se registra y vale al
instante. Nadie la aprueba, al jefe no le llega aviso y no tiene dónde verla. La persona
puede **borrar cualquier ausencia, incluso pasada**: el borrado es físico (`AbsenceRecord`
+ adjuntos), no deja rastro y le libera los minutos del tope mensual.

## Decisiones (Carlos, 2026-10-07)

- Los cuatro tipos llevan aprobación del jefe.
- Mientras está pendiente: **permiso, cita médica e incapacidad valen** (son urgentes o
  hechos consumados; el jefe aprueba después). **Vacaciones no valen hasta aprobarse.**
- Aprueba el **jefe directo** (organigrama de office); si no tiene, **RRHH**
  (`office.manage`). RRHH ve y puede resolver todas.
- Avisos al jefe: **app de escritorio** y **Bitrix**. Correo: segunda etapa (hoy no hay
  servicio de correo ni en el core ni en office).

## Modelo

`AbsenceRecord` es una tabla del core (Prisma, esquema `virtual_office`): no se le agregan
columnas. El ciclo vive en tablas del plugin (migración 009):

```sql
office_solicitudes (
  id uuid PK, user_id text, tipo text, start_at timestamptz, end_at timestamptz,
  justificacion text,
  estado text  -- pendiente | aprobada | rechazada | cancelada
  absence_id text NULL,          -- la AbsenceRecord que la hace valer (si vale)
  aprobador_id text NULL,        -- a quién le toca (jefe directo o null = RRHH)
  resuelta_por text NULL, resuelta_en timestamptz NULL, motivo_resolucion text NULL,
  creada_por text, creada_en timestamptz
)
office_solicitud_eventos (       -- historial: nunca se borra
  id bigserial PK, solicitud_id uuid, accion text, user_id text, detalle jsonb, creado_en timestamptz
)  -- accion: creada | aprobada | rechazada | cancelada | adjunto_agregado
```

Los adjuntos pasan a colgar de la solicitud (`office_absence_adjuntos.absence_id` sigue
apuntando al id que ya usan; para vacaciones pendientes se usa el id de la solicitud).

## Ciclo

| Paso | Permiso / cita / incapacidad | Vacaciones |
|---|---|---|
| Se pide | solicitud `pendiente` **y** AbsenceRecord (vale ya) | solicitud `pendiente`, **sin** AbsenceRecord |
| Jefe aprueba | `aprobada` | `aprobada` + se crea la AbsenceRecord |
| Jefe rechaza (motivo obligatorio) | `rechazada`; la AbsenceRecord se quita si todavía no empezó; si ya pasó queda en el historial como **no aprobada** | `rechazada` |
| La persona cancela | solo si **no empezó**; `cancelada` + se quita la AbsenceRecord | solo si no empezó |

- **Nada se borra físicamente**: cancelar o rechazar cambia el estado y queda el evento
  con quién, cuándo y por qué. `DELETE /absences/:id` deja de borrar: cancela la
  solicitud (y solo antes de empezar). RRHH puede anular una ausencia pasada, con motivo.
- Los minutos del tope mensual cuentan pendientes y aprobadas (no las rechazadas antes
  de empezar ni las canceladas). Una rechazada que ya ocurrió cuenta y se marca.
- Las ausencias que ya existen se migran como `aprobada` (registradas antes del ciclo).

## Pantallas

- **Persona (web y app):** «Mis ausencias» muestra el estado de cada una (pendiente /
  aprobada / rechazada con motivo / cancelada). El formulario dice «Queda pendiente de
  aprobación de {jefe}» y, en vacaciones, que no vale hasta aprobarse.
- **Jefe (web):** «Solicitudes» en office: pendientes de su equipo directo con tipo,
  fechas, motivo, adjuntos y saldo del mes; botones Aprobar / Rechazar (motivo). Pestaña
  de historial. RRHH ve todas y filtra por persona, tipo, estado y fechas; exporta CSV.
- **Jefe (app de escritorio):** contador de pendientes y notificación al llegar una;
  aprobar o rechazar desde la app.

## Avisos

- Nueva solicitud → al aprobador: evento en vivo (app de escritorio y web) + aviso de
  Bitrix (`im.notify.system.add`, con enlace a la bandeja).
- Resuelta → a la persona: lo mismo, con el motivo si se rechazó.
- Recordatorio diario (9:00) al jefe con lo pendiente de más de 24 h.

## Permisos

- Crear y cancelar las propias: `office.checkin` (como hoy).
- Resolver: el jefe directo del solicitante, o `office.manage`.
- Ver motivo y adjuntos: igual que hoy (la persona, su jefe directo, RRHH).

## Pruebas

Reglas puras (transiciones válidas, quién puede resolver, qué cuenta para el tope, qué
hace cada transición con la AbsenceRecord) en `src/lib/solicitudes.ts` con vitest; el SQL
con el patrón `listaIn` (sin `ANY()` ni `Date`). E2E con Playwright de la bandeja.

## Fuera de esta etapa

Correo; saldo anual de vacaciones (días disponibles); doble aprobación; delegar la
aprobación cuando el jefe está ausente.
