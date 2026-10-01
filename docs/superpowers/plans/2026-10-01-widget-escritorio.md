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

El callback por usuario apunta a `/api/v1/p/office/bitrix/oauth/callback`, no
al callback de administración que Bitrix ya conoce.

- [ ] Armar a mano la URL de authorize con ese `redirect_uri` y abrirla con el
      usuario de Carlos.
- [ ] Confirmar que Bitrix redirige con `code`, o anotar el error exacto.

**Si Bitrix lo rechaza:** el callback por usuario pasa a vivir en el core,
junto al de administración, y reenvía al plugin. Cambia la Tarea 3 y la 9.

---

## Fase A — Core (`vla-system`, en el servidor)

### Tarea 3: OAuth por usuario en el cliente de Bitrix

**Archivos (en el servidor, `/var/www/sites/system-somosvla`):**
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

userAuthorizeUrl(redirectUri: string, state: string): string;
exchangeUserCode(code: string, redirectUri: string): Promise<BitrixUserTokens>;
refreshUserToken(refreshToken: string): Promise<BitrixUserTokens>;
callAsUser<T = any>(accessToken: string, method: string, params?: Record<string, unknown>): Promise<T>;
```

- [ ] **Respaldar** los cuatro archivos en el servidor con sufijo de fecha.
- [ ] Bajar esos cuatro archivos a una carpeta de trabajo local. **No** editar
      la copia del repo local: está desfasada.
- [ ] Pruebas primero: `userAuthorizeUrl` arma la URL con `client_id`,
      `redirect_uri` codificado y `state`; `exchangeUserCode` y
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
- `GET /bitrix/oauth/start` (logueado) → redirige al authorize de Bitrix.
- `GET /bitrix/oauth/callback?code&state` → canjea, guarda, redirige a la
  oficina con un aviso.
- `GET /bitrix/oauth/estado` → `{ conectado: boolean, desde?: string }`.

- [ ] `state` firmado y de un solo uso, guardado en Redis 10 minutos: sin él,
      cualquiera podría hacerle conectar a otra persona una cuenta ajena.
- [ ] Prueba: un callback con `state` desconocido o ya usado se rechaza.
- [ ] Prueba: el callback guarda los tokens del usuario del `state`, no del que
      tenga la cookie.

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

**Tarea 1 cerrada: camino bucle.** Bitrix no expone `OnImMessageAdd` a apps
REST; descartado el camino eventos.

En cualquiera de los dos caminos, el aviso sale por:
- `presence.broadcastToUser(userId, { type: 'im:new', dialogId, preview })`
- `ctx.hooks.doAction('core.push.send', { userId, title, body, url })`

- ~~**Camino eventos:**~~ descartado (ver Tarea 1).
- [ ] **Presupuesto de llamadas:** `batch` no sirve (un token por usuario). Con
      23 personas cada 30 s son ~0,8 llamadas/s, compartiendo el límite del
      portal (~2/s) con cobros. Por eso: intervalo 30 s, y solo se consulta a
      quien tiene el widget o la oficina abierta (conexión SSE viva).
- [ ] **Camino bucle:** cron que recorre a los conectados **de a uno**, con
      pausa entre llamadas y retroceso exponencial ante error; compara
      `im.counters.get` contra el valor anterior y avisa si subió. Lógica de
      comparación en `src/lib/` con pruebas, como `compararVentana`.
- [ ] En ambos: el primer tick tras arrancar solo fija la línea base, igual que
      en `absence-window.ts`.

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
