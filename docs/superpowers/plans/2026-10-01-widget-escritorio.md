# Widget de escritorio — Plan de implementación

> **Para quien ejecute:** tareas con casillas (`- [ ]`). Cada tarea cierra con
> pruebas en verde y un commit. Las dos primeras son **compuertas**: si fallan,
> el plan cambia antes de escribir código.

**Objetivo:** un ícono en la bandeja de Windows, para las 23 personas, que avisa
cuando alguien escribe o invita a reunión y deja cambiar de estado.

**Arquitectura:** Bitrix es el sistema de mensajería. El core gana OAuth por
usuario, push genérico y autorización de dispositivo. El plugin office guarda
los tokens de cada persona y hace de proxy de `im.*`. El widget, en Electron,
consume ese proxy y el SSE que ya existe.

**Tecnologías:** NestJS (core), Express + Postgres (plugin), Electron + Vite +
React + TypeScript (widget), electron-builder (instalador NSIS sin firmar).

**Spec:** `docs/superpowers/specs/2026-10-01-widget-escritorio-design.md`

## Restricciones globales

Valen para todas las tareas. Cada una viene de un fallo real ya ocurrido.

- **Español** en interfaz, comentarios y mensajes de error.
- **Toda ruta `async` va envuelta en `asyncRoute`.** Express 4 no atrapa
  rechazos y uno solo tumba el API entero.
- **SQL crudo por `ctx.query`:** nada de `= ANY($1)` (usar `IN` con marcadores
  numerados), nada de `Date` como parámetro (usar texto ISO). Ambos revientan en
  producción y pasan las pruebas.
- **Zonas horarias:** `timestamp without time zone` necesita conversión doble,
  `timestamptz` simple. Verificar el tipo antes de convertir.
- **Rutas literales antes que paramétricas.**
- **Bitrix: llamadas serializadas y con retroceso exponencial**, nunca en
  paralelo. Una auditoría sin freno dejó 3 pagos varados el 3-ago-2026.
- **Core: nunca sincronizar el árbol local completo al servidor.** Está
  desfasado y ya rompió el login. Archivo por archivo, con respaldo previo.
- **Antes de reiniciar `vla_api`, medir los senders de WhatsApp.** Un sender
  degradado no vuelve.
- **Probar sobre el usuario de Carlos (949)**, nunca mandar mensajes de prueba a
  otras personas.
- **Cada prueba nueva se verifica por sabotaje:** romper la guarda y ver que
  falle. Varias de este proyecto pasaban vacías.

---

## Fase 0 — Compuertas

### Tarea 1: ¿Bitrix nos avisa de mensajes nuevos?

Decide la Tarea 11. Con webhook dio `WRONG_AUTH_TYPE`; hay que probar con el
token OAuth de la aplicación, que el core ya tiene.

- [x] Script de un solo uso **dentro del contenedor del API** (lo corrió
      Carlos: el clasificador bloquea leer el token de producción).
      `event.get` con el token OAuth de la app responde 200 (5 eventos ya
      registrados: ONAPPINSTALL y los 4 CRM de cobros).
- [x] `events` lista solo eventos IM de **conectores abiertos** y de **bots**
      (`ONIMCONNECTOR*`, `ONIMBOT*`, `ONIMBOTV2*`). `event.bind` de
      `OnImMessageAdd` → `ERROR_EVENT_NOT_FOUND`. No se mandó el mensaje de
      prueba ni quedó nada registrado.
- [x] **Resultado (1-oct-2026): no hay evento de mensaje entre personas.**
      Un bot solo ve mensajes dirigidos a él o a chats donde lo agreguen, no
      los mensajes directos entre colaboradores. Tarea 11 = camino bucle.

**Si funciona:** Tarea 11 = receptor de eventos. **Si no:** Tarea 11 =
consulta en bucle con freno. No se escribe código de la 11 antes de saberlo.

### Tarea 2: ¿Bitrix acepta un `redirect_uri` del plugin?

Se probó si el callback por usuario podía apuntar a `/api/v1/p/office/bitrix/oauth/callback`, no
al callback de administración que Bitrix ya conoce.

- [x] URL de authorize armada a mano con `client_id` del core y ese
      `redirect_uri`; la abrió Carlos con su usuario.
- [x] **Resultado (1-oct-2026): Bitrix ignora el `redirect_uri`.** Mandó el
      `code` al callback de administración registrado en la app, y el core lo
      canjeó como token **global** (`/dashboard/admin?tab=integrations&bitrix=connected`).
      Sin daño: el token global ya era de Carlos (949).
- [x] **Hallazgo de seguridad:** el callback de administración es público (tiene
      que serlo) y **no valida `state`**: aceptó `state=prueba`. Cualquier
      persona del portal que complete un authorize de esta app reemplaza el
      token global por el suyo, y cobros, office y dashboards pasan a correr con
      sus permisos. Hoy basta con que alguien abra un enlace armado; con el
      widget, cada «Conectar mi Bitrix» lo haría. **Se corrige en la Tarea 3,
      antes de que exista el botón.**

**Consecuencia:** el callback por usuario vive en el core, en el mismo
endpoint de administración, y distingue por `state`. Cambian la Tarea 3 y la 9.

---

## Fase A — Core (`vla-system`, en el servidor)

### Tarea 3: OAuth por usuario en el cliente de Bitrix

**Archivos (en el servidor, `/var/www/sites/system-somosvla`):**
- Modificar: `apps/api/src/core/integrations/bitrix/bitrix.controller.ts`
- Modificar: `apps/api/src/core/integrations/bitrix/bitrix.service.ts`
- Modificar: `apps/api/src/core/integrations/bitrix/bitrix.types.ts`
- Modificar: `packages/plugin-sdk/src/types.ts`
- Modificar: `apps/api/src/core/plugin-loader/plugin-context.factory.ts`
- Prueba: `apps/api/src/core/integrations/bitrix/bitrix.service.spec.ts`

**Interfaz que produce** (en `PluginBitrixClient` del SDK):

```ts
export interface BitrixUserTokens {
  accessToken: string;
  refreshToken: string;
  /** Instante absoluto, en milisegundos. */
  expiresAt: number;
}

/** Crea el state en Redis (10 min, un solo uso) y devuelve la URL de authorize. */
userAuthorizeUrl(userId: string, returnTo: string): Promise<string>;
refreshUserToken(refreshToken: string): Promise<BitrixUserTokens>;
callAsUser<T = any>(accessToken: string, method: string, params?: Record<string, unknown>): Promise<T>;
```

**Callback único, que distingue por `state`** (Bitrix siempre vuelve al de
administración, Tarea 2):

| `state` recibido | Qué hace |
|---|---|
| `a.<aleatorio>` creado por `/authorize` (admin) y vigente | canjea y guarda como token **global**, como hoy |
| `u.<aleatorio>` creado por `userAuthorizeUrl` y vigente | canjea, dispara `core.bitrix.user_authorized` `{ userId, tokens }`, redirige a `returnTo` |
| ausente, desconocido, vencido o ya usado | **no canjea**; redirige con `bitrix=error&msg=state` |

- [ ] `/authorize` (admin) pasa a crear su `state` `a.…` en Redis, 10 min.
- [ ] El `state` se borra al leerlo (`GETDEL`): un solo uso.
- [ ] `returnTo` solo puede ser una ruta relativa que empiece con `/` (no
      `//`): sin eso es un redirect abierto.
- [ ] Prueba clave, por sabotaje: un callback con `state` `u.…` **jamás**
      toca el token global; uno sin `state` no canjea nada.
- [ ] Antes de editar, comparar el controlador del servidor con la copia local
      (la local está desfasada; la que manda es la del servidor).
- [ ] **Respaldar** los archivos en el servidor con sufijo de fecha.
- [ ] Bajar esos cuatro archivos a una carpeta de trabajo local. **No** editar
      la copia del repo local: está desfasada.
- [ ] Pruebas primero: `userAuthorizeUrl` arma la URL con `client_id`,
      el `redirect_uri` de administración codificado y un `state` `u.…`
      guardado en Redis con `{ userId, returnTo }`; el canje y
      `refreshUserToken` mapean la respuesta de `oauth.bitrix.info` a
      `BitrixUserTokens`; `callAsUser` manda el token recibido y **nunca** el
      global.
- [ ] La prueba clave: `callAsUser` con un token A no usa el token de la
      aplicación. Verificar por sabotaje.
- [ ] El `clientSecret` no aparece en ningún valor de retorno ni en logs.

### Tarea 4: Hook genérico de push

**Archivos:** Modificar `apps/api/src/core/push/push.service.ts`, prueba en
`push.service.spec.ts`.

- [ ] Prueba: disparar `core.push.send` con `{userId, title, body, url}` llama a
      `sendToUser` con esos datos.
- [ ] Prueba: un payload sin `userId` se descarta con un aviso en el log, no
      revienta.
- [ ] Implementar junto al `registerAction('dashboards.new_leads', …)` que ya
      existe.

### Tarea 5: Autorización de dispositivo

**Archivos:** Crear `apps/api/src/core/auth/device.service.ts` y su prueba;
modificar `auth.controller.ts` y `auth.module.ts`.

**Contrato:**

| Endpoint | Auth | Respuesta |
|---|---|---|
| `POST /auth/device/start` | pública | `{ userCode, deviceCode, expiresIn: 300, interval: 3 }` |
| `POST /auth/device/confirm` `{userCode}` | JWT | `{ ok: true }` · 404 si no existe o venció |
| `POST /auth/device/token` `{deviceCode}` | pública | `{ status: 'pending' }` · `{ status: 'ok', accessToken }` una vez · 404 si venció |

- [ ] `userCode`: 6 caracteres de un alfabeto **sin ambiguos** (sin 0/O, 1/I/L).
- [ ] `deviceCode`: 32 bytes aleatorios en hexadecimal.
- [ ] Redis: `device:user:{userCode}` → `deviceCode`; `device:dev:{deviceCode}`
      → `{ status, userId }`. Vencimiento 300 s en ambos.
- [ ] El token se entrega **una sola vez**: al entregarlo se borran las claves.
- [ ] Freno en `/start` y `/token` por IP, para que nadie barra códigos.
- [ ] Pruebas: código vencido da 404; segundo canje del mismo `deviceCode` da
      404; confirmar un código ajeno no filtra quién lo pidió; el alfabeto no
      contiene ambiguos.

### Tarea 6: Desplegar el core

- [ ] Correr las pruebas del core localmente sobre la carpeta de trabajo.
- [ ] **Medir los senders de WhatsApp** antes de tocar nada.
- [ ] Subir los archivos modificados uno por uno y comparar el hash de cada uno
      contra la carpeta de trabajo.
- [ ] `docker compose build api` y recrear el contenedor.
- [ ] Verificar: login con Google sigue funcionando; `/auth/device/start`
      responde; los senders siguen conectados.
- [ ] **Plan de vuelta atrás:** restaurar los respaldos y reconstruir. Probarlo
      mentalmente antes de empezar, no durante el incidente.

### Tarea 7: Vendorizar el SDK en office

- [ ] Copiar la salida compilada de `packages/plugin-sdk` a
      `vla-plugin-office/vendor/plugin-sdk/`.
- [ ] `tsc --noEmit` en office: debe compilar con los tipos nuevos.
- [ ] Commit en office.

---

## Fase B — Plugin office

### Tarea 8: Tokens por usuario

**Archivos:** Crear `migrations/004_bitrix_tokens.up.sql` y `.down.sql`,
`src/lib/token-vigencia.ts` y su prueba, `src/services/bitrix-user.service.ts`.

```sql
CREATE TABLE IF NOT EXISTS office_bitrix_tokens (
  user_id       text PRIMARY KEY,
  access_token  text        NOT NULL,
  refresh_token text        NOT NULL,
  expires_at    timestamptz NOT NULL,
  conectado_at  timestamptz NOT NULL DEFAULT now()
);
```

**Lógica pura** en `token-vigencia.ts`:

```ts
/** Refrescar con margen: un token que vence en 30 s puede vencer en vuelo. */
export function necesitaRefresco(expiresAt: number, ahora: number, margenMs = 60_000): boolean;
```

- [ ] Pruebas de `necesitaRefresco`: vencido, por vencer dentro del margen,
      vigente, y el borde exacto.
- [ ] `BitrixUserService`: `guardar`, `obtenerVigente` (refresca si hace falta y
      persiste el nuevo par), `desconectar`.
- [ ] Si el refresco falla con `invalid_grant`, **borrar** los tokens: la
      persona revocó el acceso y hay que pedirle que reconecte, no reintentar
      para siempre.
- [ ] Prueba que inspecciona el SQL: ningún `ANY(`, ningún `Date` como
      parámetro, marcadores iguales a la cantidad de parámetros.
- [ ] **Verificar que la migración viaja en el zip:** `pack.js` debe reportar 4.

### Tarea 9: Conectar mi Bitrix

**Endpoints:**
- `GET /bitrix/oauth/start` (logueado) → `ctx.bitrix.userAuthorizeUrl(userId, '/dashboard/office?bitrix=conectado')` y redirige.
- `GET /bitrix/oauth/estado` → `{ conectado: boolean, desde?: string }`.
- **Sin callback propio:** Bitrix no lo respeta (Tarea 2). El plugin escucha
  `core.bitrix.user_authorized` y guarda con `BitrixUserService.guardar`.
- [ ] Declarar `core.bitrix.user_authorized` en `hooks.listens` del manifiesto.
- [ ] Prueba: el handler guarda los tokens del `userId` del evento, no de otro.
- [ ] Verificación en vivo: Carlos conecta su Bitrix y el token global sigue
      igual (comparar `expiresAt` del global antes y después).

### Tarea 10: Proxy de mensajería

| Endpoint | Traduce a |
|---|---|
| `GET /im/recent` | `im.recent.get` |
| `GET /im/counters` | `im.counters.get` |
| `GET /im/dialog/:dialogId` | `im.dialog.messages.get` |
| `POST /im/message` `{toBitrixUserId, text}` | `im.message.add` |
| `POST /im/read` `{dialogId}` | `im.dialog.read` |

- [ ] Todos con `callAsUser` y el token de **quien pregunta**.
- [ ] Sin Bitrix conectado → **409** con
      `{ message: 'Conectá tu Bitrix para usar la mensajería', conectar: '/api/v1/p/office/bitrix/oauth/start' }`.
      Nunca una lista vacía, que se leería como «no tenés mensajes».
- [ ] `POST /im/message`: texto de 1 a 2000 caracteres, recortado.
- [ ] Prueba clave, por sabotaje: el proxy usa el token del solicitante y no el
      global.
- [ ] Verificación en vivo: Carlos se manda un mensaje a sí mismo por el proxy;
      aparece firmado por Carlos en el Bitrix web. Borrarlo después.

### Tarea 11: Aviso de mensaje nuevo

**Camino mixto (decidido 1-oct-2026).** Bitrix no expone `OnImMessageAdd` a
apps REST (Tarea 1), pero los mensajes que salen por nuestro proxy ya nos dicen
quién es el destinatario.

El aviso sale siempre por:
- `presence.broadcastToUser(userId, { type: 'im:new', dialogId, preview })`
- `ctx.hooks.doAction('core.push.send', { userId, title, body, url })`

- [ ] **1. Aviso inmediato** dentro de `POST /im/message`: si `im.message.add`
      responde bien y el destinatario es usuario VLA (vía `BitrixUserMapping`),
      avisarle al instante. El remitente no se avisa a sí mismo. Si el aviso
      falla, el mensaje igual cuenta como enviado (el aviso no es parte de la
      respuesta).
- [ ] **2. Consulta de respaldo cada 2 minutos** para lo que no pasa por
      nosotros: Bitrix web o celular, chats grupales, gente fuera del equipo,
      notificaciones del sistema. Cron que recorre **de a uno** solo a quien
      tiene una conexión SSE viva (widget u oficina abierta), con pausa entre
      llamadas y retroceso exponencial ante error. Compara `im.counters.get`
      contra el valor anterior y avisa si subió. Presupuesto: 23 personas cada
      120 s ≈ 0,2 llamadas/s, frente al límite del portal (~2/s) compartido con
      cobros. `batch` no sirve: un token por usuario.
- [ ] **3. Sin doble aviso:** cuando el camino 1 avisa, sube en uno la línea
      base guardada del destinatario, para que la siguiente consulta no vea
      ese mensaje como nuevo. Si la consulta encuentra el contador **por debajo**
      de la base (la persona leyó), la base baja al valor real y no se avisa.
- [ ] El primer tick tras arrancar solo fija la línea base, igual que en
      `absence-window.ts`.
- [ ] Lógica pura en `src/lib/im-aviso.ts` con pruebas (como
      `compararVentana`): `decidirAviso(base|null, contador)` y
      `registrarAvisoInmediato(base)`. Casos mínimos: primer tick, subió,
      igual, bajó, aviso inmediato seguido de consulta sin mensajes nuevos
      (no avisa), aviso inmediato más otro mensaje por Bitrix (avisa uno).
      Verificar por sabotaje.

### Tarea 12: Pantallas en la oficina virtual

**Archivos:** frontend de office.

- [ ] Botón **Conectar mi Bitrix** en el menú de usuario, con su estado.
- [ ] Pantalla **Vincular escritorio**: campo para el código de 6 caracteres,
      que llama a `/auth/device/confirm` del core.
- [ ] Mensajes de error que dicen qué hacer: código vencido, código mal escrito.
- [ ] Verificación en el navegador con Playwright.

---

## Fase C — Widget (`vla-widget`, repositorio nuevo)

### Tarea 13: Andamio

- [ ] Repo `vla-widget` junto a los demás, remoto
      `github.com/aguisoft/vla-widget`.
- [ ] Electron + Vite + React + TypeScript + Tailwind, con el mismo
      `statusConfig.ts` y los mismos íconos SVG que office (copiados, con
      comentario de dónde salen).
- [ ] Proceso principal y de interfaz separados; `contextIsolation: true`,
      `nodeIntegration: false`. La interfaz no toca Node.

### Tarea 14: Vinculación y guardado del token

- [ ] Primera apertura: pide código a `/auth/device/start`, lo muestra grande,
      consulta `/auth/device/token` cada 3 s hasta 5 minutos.
- [ ] Token guardado con `safeStorage` de Electron (cifrado por el usuario de
      Windows), **nunca** en un archivo plano.
- [ ] Ante 401: borrar el token y volver a vincular. El JWT dura 7 días.

### Tarea 15: Ícono de bandeja

- [ ] Once íconos de bandeja, uno por estado, con el color de `statusConfig`.
      Generados a 16 y 32 px.
- [ ] Clic izquierdo abre el panel; clic derecho, menú con los estados y Salir.
- [ ] Insignia de cantidad sin leer.

### Tarea 16: Panel

- [ ] Selector de estado — reutilizando las reglas de justificación y rango
      que valida el servidor, para que la interfaz no prometa lo que el
      backend va a rechazar.
- [ ] Conversaciones con sin leer, hilo, caja de respuesta.
- [ ] Invitaciones a reunión pendientes, con aceptar y rechazar.
- [ ] Estado de Bitrix sin conectar: explicar y llevar a conectarlo, no
      mostrarse vacío.

### Tarea 17: En vivo y avisos

- [ ] SSE con el token como Bearer: no se puede con `EventSource` del
      navegador, así que va por el proceso principal.
- [ ] Reconexión con retroceso.
- [ ] Aviso nativo de Windows en `im:new` y en invitación; clic abre el hilo.
- [ ] No avisar de mensajes propios.

### Tarea 18: Instalador

- [ ] electron-builder, NSIS, **sin firmar** — decidido.
- [ ] Arranque con Windows opcional, activado por defecto.
- [ ] Guía de una página con capturas de la advertencia de SmartScreen y cómo
      pasarla ("Más información" → "Ejecutar de todos modos").

---

## Fase D — Despliegue

### Tarea 19: Piloto

- [ ] Carlos y dos personas más durante una semana.
- [ ] Medir: mensajes que llegaron tarde o no llegaron, reconexiones, consumo
      de Bitrix (llamadas por minuto).

### Tarea 20: Las 23 personas

- [ ] Instalador y guía al equipo.
- [ ] Seguimiento de quién conectó su Bitrix: el widget sin eso no tiene
      mensajería.

---

## Pendiente antes de empezar

**La decisión de Vibe+.** El 1-mar-2027 la API REST sale del plan Professional.
Con esta arquitectura ese día el widget deja de funcionar. No bloquea empezar,
pero conviene tenerla tomada antes de pedirle a 23 personas que instalen algo.
