# Dashboard de tiempo por estado — diseño

**Fecha:** 2026-09-22
**Plugin:** `vla-plugin-office` (v1.2.0 en producción)
**Autor:** Claude, con decisiones de Carlos Aguinaga

## Qué construye

Un dashboard donde cada jefe ve cuánto tiempo pasó cada uno de sus colaboradores
directos en cada estado, y cuánto tiempo estuvo en la oficina.

Ruta propia: `/dashboard/office-tiempos`, con entrada en el menú lateral.

## El hecho que condiciona todo

**No existe historial de estados.** `PresenceStatus` guarda una fila por persona y
se sobreescribe en cada cambio; `statusStartsAt` está en `NULL` en las 36 filas de
producción. Cuando alguien pasa de Disponible a Concentrado, el valor anterior se
pierde sin dejar rastro.

Medido en producción el 2026-09-18:

| Tabla | Filas | Rango | Sirve para |
|---|---|---|---|
| `PresenceStatus` | 36 | solo el ahora | nada retroactivo |
| `CheckInRecord` | 2869 | 2026-04-08 → hoy, 157 días | tiempo en oficina |
| `AbsenceRecord` | 0 | — | ausencias (vacío aún) |

Consecuencia: **el desglose por estado arranca vacío y se llena hacia adelante.**
No hay forma de reconstruir agosto. El tiempo en oficina sí es retroactivo a abril.

Por eso el proyecto se parte en dos entregas con valor independiente.

## Entrega 1 — Tiempo en oficina

Agregación sobre `CheckInRecord`, que ya tiene 2823 sesiones cerradas con
`totalMinutes`. Sin tabla nueva, sin migración, sin tocar el core: **despliegue
solo del plugin.**

Por persona y por día: suma de `totalMinutes` de las sesiones cerradas, más la
sesión abierta recortada contra `min(now, fin_del_período)` — el mismo recorte que
los intervalos, para que consultar una semana vieja no muestre una sesión
corriendo hasta hoy. Una sesión que cruza la medianoche se parte por día con la
misma función de recorte. Agregable por semana y por mes.

Sirve el día uno, con 157 días de datos reales.

## Entrega 2 — Desglose por estado

### La tabla

Tabla propia del plugin, creada por una migración del plugin (mismo patrón que
`vla-plugin-cobros`, que es dueño de `accounts`, `actions`, `agreements`). Se
accede con `$queryRawUnsafe`. **No requiere cambio en el esquema del core**, y por
lo tanto no requiere reconstruir la imagen ni desplegar el core.

`vla-plugin-office` todavía no tiene directorio `migrations/`: esta es la primera,
y va como `migrations/001_status_intervals.up.sql` con su `.down.sql`. Sin prefijo
de esquema en el SQL, como pide el procedimiento de despliegue. El core la aplica
sola al arrancar y la registra en `core."PluginMigration"`.

```sql
CREATE TABLE IF NOT EXISTS office_status_intervals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text        NOT NULL,
  status        text        NOT NULL,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  justification text,
  source        text        NOT NULL DEFAULT 'WEB'
);

CREATE INDEX IF NOT EXISTS office_status_intervals_user_time_idx
  ON office_status_intervals (user_id, started_at);
CREATE INDEX IF NOT EXISTS office_status_intervals_time_idx
  ON office_status_intervals (started_at);

-- La invariante que impide contar doble: como máximo UN intervalo abierto por
-- persona. La garantiza Postgres, no el cuidado del programador.
CREATE UNIQUE INDEX IF NOT EXISTS office_status_intervals_one_open_per_user
  ON office_status_intervals (user_id) WHERE ended_at IS NULL;
```

**`status` es `text` y no un enum a propósito.** La tabla del plugin no debe
depender de `virtual_office."OfficeStatus"`, que vive en otro esquema y ya cambió
una vez (el 2026-09-15 se eliminaron `BUSY` e `IN_MEETING`). Un enum compartido
haría que un cambio del core rompa esta tabla. La validación del valor vive en
código.

`source` distingue si la transición la produjo una acción del colaborador (`WEB`) o
el cron de timeman de Bitrix (`BITRIX`). Sirve para responder «¿se marcó él, o lo
marcó el sistema?» cuando un número no cuadre, que es la primera pregunta que
aparece al auditar un reporte de tiempos.

Volumen estimado: 35 personas × ~10 cambios por día × 250 días hábiles ≈ **87 mil
filas al año**. No necesita particionado ni archivado.

### Siembra en el despliegue

Al aplicar la migración, nadie tiene intervalo abierto: el primero se abriría
recién en la siguiente transición de cada persona. Quien esté sentado en
Concentrado ese día no aparecería hasta que cambie de estado, y podrían pasar
horas.

La migración cierra ese hueco sembrando un intervalo abierto por cada fila de
`virtual_office."PresenceStatus"`, con `started_at = now()` y el estado actual.
El tiempo anterior no se inventa —no existe—, pero desde el minuto del despliegue
todo el mundo queda contabilizado.

### Dónde se escribe

Los tres únicos caminos que escriben `PresenceStatus.status` están en
`src/services/presence.service.ts`, verificado leyendo el código:

| Método | Estado que escribe |
|---|---|
| `checkIn` | `AVAILABLE` |
| `checkOut` | `OFFLINE` |
| `updateStatus` | el que se pidió |

`layout.service.ts` solo escribe posición y zona. El `upsert` de `index.ts:583`
usa `update: {}` — solo crea la fila si falta, no transiciona a nadie.

El cron de timeman (cada 2 minutos) **no escribe cada vez**: pasa por
`presence.checkIn`/`checkOut` y solo cuando `isCheckedIn` realmente cambia. El
temor a un log lleno de ruido era infundado.

Se agrega un helper privado en `presence.service`:

```ts
private async recordTransition(
  userId: string,
  status: string,
  at: Date,
  justification: string | null,
  source: 'WEB' | 'BITRIX',
): Promise<void>
```

Reglas:

1. Si el intervalo abierto de esa persona **ya tiene ese mismo estado**, solo se
   actualiza su `justification` si cambió. **No se parte.** Reescribir el motivo de
   un Concentrado no debe cortar el tiempo acumulado.
2. Si el estado cambió: en **una transacción**, se cierra el abierto
   (`ended_at = at`) y se inserta el nuevo.
3. Si no hay intervalo abierto, simplemente se abre uno.

### Un fallo de registro no rompe la presencia

`recordTransition` se llama dentro de un `try/catch` que registra un warning y
sigue. **El cambio de estado del colaborador nunca falla porque falló el log.**

Es una decisión consciente con un costo: un fallo deja el registro divergido de la
realidad y nadie se entera hasta mirar el reporte. Se acepta porque la alternativa
es peor — que alguien no pueda marcarse Concentrado porque una tabla de
observabilidad tuvo un problema. El log es instrumentación, no el producto.

## Qué significan los números

### OFFLINE queda fuera

No entra en el desglose ni en la base del porcentaje. Se reporta aparte como
«no conectado».

El motivo es aritmético: alguien que queda OFFLINE el viernes a las 18:00 y vuelve
el lunes a las 08:00 acumula 62 horas en ese estado. Sumado al mismo gráfico,
OFFLINE se come todo lo demás y los porcentajes dejan de decir nada.

### Las dos fuentes van a discrepar, y eso se muestra

El tiempo en oficina sale de `CheckInRecord` (entrada → salida) y el desglose sale
de los intervalos. Miden lo mismo por caminos distintos, así que **no van a
coincidir exactamente**: un `recordTransition` que falló y se tragó su warning, o
un intervalo abierto al desplegar la siembra, dejan tiempo conectado sin estado
asignado.

Ignorar la diferencia sería peor que mostrarla. La regla:

- **`CheckInRecord` es la autoridad del tiempo conectado.** Es el dato que existe
  desde abril y el que la gente reconoce como «mi jornada».
- El desglose por estado es una **subdivisión** de ese total, y la suma de sus
  tramos es menor o igual.
- La diferencia se muestra como **«sin registrar»**, con su propia franja en el
  gráfico.

Un «sin registrar» que crece es la señal de que el registro está perdiendo
escrituras. Escondido en un redondeo, ese síntoma no se ve nunca.

### El intervalo abierto

Se cierra contra `now()` o contra el fin del período consultado, **el menor de los
dos**. Consultar la semana pasada no debe mostrar un estado que sigue corriendo
como si hubiera durado hasta hoy.

### Recorte por día

Un intervalo puede cruzar la medianoche. Para la vista diaria se recorta:

```
inicio_efectivo = GREATEST(started_at, inicio_del_día)
fin_efectivo    = LEAST(COALESCE(ended_at, now()), fin_del_día)
```

Un Concentrado de lunes 23:00 a martes 01:00 aporta 1h al lunes y 1h al martes.

### Ausencias y feriados

No salen de intervalos: **no viven en `PresenceStatus`**, se calculan al vuelo en
el snapshot. Su tiempo sale de otro lado:

- `AbsenceRecord`: rangos de fecha por tipo (PERMISO / VACACIONES / INCAPACIDAD)
- Feriados: la resolución efectiva ya existente (país del colaborador + overrides)

Un día completo de ausencia cuenta como **una jornada fija configurable**, nueva
clave en `ctx.plugin.config`, con 8 horas por defecto. No se infiere de los datos
porque no hay dato del que inferirla.

PERMISO es la excepción: viaja con hora de inicio y fin dentro del mismo día, así
que aporta su duración real, no la jornada completa.

### Zona horaria

El API y Postgres corren en UTC; la operación es UTC−6. Los límites de día, semana
y mes se calculan en la zona local del plugin (`DEFAULT_TZ`, ya existente en
`src/lib/local-date.ts`), no en UTC. Un día va de las 00:00 locales a las 23:59:59
locales.

Este proyecto ya tuvo dos bugs por esto — `sameLocalMonth` invirtiendo feriados de
día 1, y la doble conversión de zona en las ausencias de día completo. La
aritmética de períodos va en funciones puras probadas, no inline en el SQL.

## Lógica pura, probada sin base de datos

Nuevo archivo `src/lib/timesheet.ts`, siguiendo el patrón del repo:

- Recorte de un intervalo contra un rango (el `GREATEST`/`LEAST` de arriba)
- Partición de un intervalo que cruza medianoche en tramos por día
- Cierre del intervalo abierto contra `min(now, fin_del_período)`
- Base del porcentaje excluyendo OFFLINE
- Conversión de días de ausencia a horas según la jornada configurada
- Límites de día/semana/mes en zona local

Todo con vitest, sin mocks, como `status-rules.ts` y `holiday-resolver.ts`.

## El acceso

```
GET /p/office/timesheet?from=YYYY-MM-DD&to=YYYY-MM-DD[&userId=]
```

El servidor resuelve el conjunto visible:

| Quién | Ve |
|---|---|
| Cualquiera | a sí mismo |
| Jefe | a sí mismo + sus directos (`org.managedUserIds`) |
| ADMIN | a todos |

`managedUserIds` ya implementa «directo» sin subárbol y ya contempla el override
de `UserProfileOverride.managerUserId` ganándole a la jerarquía de Bitrix.

**Pedir alguien fuera del conjunto devuelve 403, nunca un resultado vacío.** Un
vacío se lee como «no hizo nada», y eso es peor que un error: induce a una
conclusión falsa sobre una persona.

Se gatea con `office.view`, que STAFF tiene. No se crea permiso nuevo: el control
real es el conjunto que resuelve el servidor, no un permiso que alguien pueda
otorgar de más.

Las justificaciones siguen la regla ya existente de `canSeeJustification`: uno
mismo, el jefe directo, o quien tenga `office.manage`. Un jefe ve el motivo del
Concentrado de su gente; un par no.

## El jefe directo

**14 de 35 personas no tienen `departmentId` en Bitrix**, así que no se les puede
resolver jefe y quedarían invisibles para todos en el dashboard.

Se extiende la pestaña Personas de `HolidayManager` (desplegada en v1.2.0) con un
selector de jefe por colaborador, con el mismo patrón que el país: muestra el jefe
resuelto y su origen (override / jefe de departamento de Bitrix / ninguno).

`PUT /org/:userId` ya acepta `managerUserId` y ya rechaza con 400 que alguien sea
su propio jefe. `GET /org/roster` ya devuelve `managerUserId`. Falta solo la UI.

## La pantalla

Período por defecto: **la semana actual**, con selector para ver un día puntual o
el mes. La semana es el grano donde se nota un patrón sin que una reunión larga lo
distorsione.

Contenido:

1. **Selector de persona** — limitado al conjunto visible. Si el viewer no tiene
   gente a cargo, no hay selector: ve lo suyo.
2. **Tiempo en oficina** del período, con el detalle por día.
3. **Desglose por estado** — horas y porcentaje sobre tiempo conectado, con los
   colores de `statusConfig.ts` para que un Concentrado se vea igual acá que en el
   mapa.
4. **Ausencias y feriados** del período, en días y en horas equivalentes.
5. **Aviso de cobertura** cuando el período consultado empieza antes del inicio del
   registro: «el desglose por estado empezó a registrarse el <fecha>». La fecha
   sale de `MIN(started_at)` de la tabla, no de una constante ni de un valor de
   configuración: así sigue siendo cierta aunque la tabla se recree o se purgue.
   Sin este aviso, una semana vacía se lee como «no trabajó».

El punto 5 no es decorativo: durante las primeras semanas la mayoría de las
consultas caerán parcial o totalmente fuera del rango con datos. El tiempo en
oficina sí tendrá datos en ese mismo período, lo que agrava la confusión si el
desglose aparece vacío sin explicación.

## Pruebas

- **Lógica pura** (`src/lib/timesheet.ts`): recorte, cruce de medianoche, intervalo
  abierto, base del porcentaje, conversión de ausencias, límites en zona local.
  vitest sin mocks. Casos obligatorios: intervalo que empieza antes del período y
  termina después (debe aportar el período completo), intervalo enteramente fuera
  (cero), y el 1 de mes y el 1 de enero, que son las fechas donde la zona ya
  invirtió resultados dos veces en este plugin.
- **La reconciliación**: con tiempo conectado conocido y un intervalo faltante a
  propósito, el «sin registrar» debe dar exactamente la diferencia, y la suma de
  las franjas nunca debe superar el tiempo conectado.
- **La invariante contra base real**: transiciones rápidas sucesivas y llamadas
  concurrentes no pueden dejar dos intervalos abiertos. El índice único parcial
  debe rechazar el segundo.
- **El camino de escritura**: `checkIn` → `updateStatus` → `checkOut` deja una
  cadena de intervalos sin huecos ni solapes.
- **El acceso**: un jefe pidiendo a alguien que no es su directo recibe 403; un par
  pidiendo a un par recibe 403; ADMIN recibe todo.
- **Navegador**: la pantalla con datos reales, incluido el caso del período sin
  cobertura.

## Lo que este diseño NO hace

- No reconstruye historial anterior al despliegue. Es imposible, no una omisión.
- No mide productividad ni califica a nadie. Mide tiempo declarado en cada estado,
  que es un dato distinto.
- No exporta a Excel ni a PDF en esta versión.
- No alerta ni notifica nada.
- No toca el esquema del core.
