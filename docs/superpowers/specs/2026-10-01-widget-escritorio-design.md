# Widget de escritorio para Windows — Diseño

**Fecha:** 1 de octubre de 2026
**Estado:** propuesta, pendiente de aprobación

## El problema

Hoy, para saber si alguien te busca o para cambiar tu estado, hay que tener
abierta la pestaña de la oficina virtual y mirarla. Nadie trabaja así: la
pestaña queda enterrada entre otras veinte y el estado se vuelve mentira a las
dos horas.

Se necesita algo **siempre visible y al alcance** que avise cuando alguien
quiere comunicarse y permita cambiar de estado sin cambiar de ventana.

## Alcance acordado

| Decisión | Valor |
|---|---|
| Qué avisa | Mensajes cortos **y** invitaciones a reunión |
| Quién lo usa | Las 23 personas |
| Forma | Ícono en la bandeja del sistema, sin ventana flotante |
| Entrega | Mensajería y app de escritorio **juntas**, no por fases |
| Dónde viven los mensajes | **Bitrix**, no una tabla nuestra |
| Firma de código | Sin firmar; se acepta la advertencia de Windows |

## Lo que ya existe (verificado en producción el 1-oct-2026)

Esto no es inventario optimista: se comprobó llamando a los sistemas reales.

| Pieza | Estado comprobado |
|---|---|
| App instalable (PWA) | Manifiesto y service worker sirviéndose, HTTP 200 |
| Web Push | VAPID configurado y **12 suscripciones activas** |
| `PushService` del core | `sendToUser`, `sendToAdmins`, `sendToAll` escritos |
| Canal en vivo dirigido | `broadcastToUser` por SSE; así llegan hoy las invitaciones |
| Autenticación | El JWT sirve como **Bearer**, no solo cookie, y dura 7 días |
| Mensajería de Bitrix | `im.message.add`, `im.recent.get`, `im.dialog.messages.get`, `im.counters.get`, `im.notify.personal.add` **responden**. Se envió, leyó y borró un mensaje real |
| OAuth de Bitrix en el core | `clientId`, `clientSecret`, dominio y refresco de token ya escritos |

**Dos huecos reales, ambos verificados:**

1. **El SDK de plugins no expone push.** El core sí: `PushService` escucha el
   bus de hooks (`dashboards.new_leads`). Falta un hook genérico.
2. **Bitrix responde como UN solo usuario.** El webhook es el usuario 949
   (Carlos) y el OAuth del core guarda **un par de tokens a nivel aplicación**.
   El mensaje de prueba salió firmado "Carlos Aguinaga". Sin resolverlo, los
   mensajes de las 23 personas saldrían todos a su nombre.

## Arquitectura

```
┌──────────────────┐   mensajes      ┌─────────────────┐
│  Widget Electron │ ──────────────► │  Plugin office  │
│  (bandeja)       │ ◄────────────── │  (proxy IM)     │
└──────────────────┘   SSE + estado  └────────┬────────┘
         ▲                                    │ como CADA usuario
         │ aviso nativo                       ▼
         │                           ┌─────────────────┐
┌────────┴─────────┐                 │  Bitrix24 IM    │
│  Web Push (core) │                 │  (el almacén)   │
└──────────────────┘                 └─────────────────┘
```

**Bitrix es el sistema de mensajería.** No se construye uno propio. No hay
tabla de mensajes, ni política de retención, ni purga, ni migración. El plugin
office es un **proxy delgado** que traduce nuestras llamadas a `im.*`
ejecutándolas con el token de quien pregunta.

El argumento no es solo ahorrar trabajo: un mensaje enviado desde el widget
aparece **también en el Bitrix del teléfono y de la web**, con el historial que
ya existe. La alternativa habría creado una isla de conversaciones paralela a
la que el equipo ya usa.

### Pieza 1 — Tokens de Bitrix por usuario

Tabla nueva en el esquema del plugin:

```sql
CREATE TABLE office_bitrix_tokens (
  user_id       text PRIMARY KEY,
  access_token  text        NOT NULL,
  refresh_token text        NOT NULL,
  expires_at    timestamptz NOT NULL,
  conectado_at  timestamptz NOT NULL DEFAULT now()
);
```

Flujo: en la oficina virtual aparece «Conectar mi Bitrix» → redirección al
authorize de Bitrix con el `clientId` que el core ya tiene → callback → se
guardan los tokens de esa persona.

El refresco replica lo que el core ya hace contra `oauth.bitrix.info`, pero por
usuario: ante token vencido, refresca y reintenta **una vez**.

**Los tokens son credenciales.** El core hoy guarda los suyos en texto plano en
`SystemSetting`. Esta tabla sigue esa práctica por coherencia, y queda anotado
como deuda: son 23 credenciales de acceso a Bitrix en una tabla.

Quien no haya conectado su Bitrix recibe **409 con un mensaje que explica qué
hacer**, nunca un error genérico ni una lista vacía que se lea como «no tenés
mensajes».

### Pieza 2 — Proxy de mensajería en el plugin office

| Endpoint | Traduce a | Para qué |
|---|---|---|
| `GET /im/recent` | `im.recent.get` | Lista de conversaciones |
| `GET /im/dialog/:id` | `im.dialog.messages.get` | Hilo con una persona |
| `POST /im/message` | `im.message.add` | Enviar |
| `GET /im/counters` | `im.counters.get` | Cuántos sin leer |
| `POST /im/read` | `im.dialog.read` | Marcar leído |

Todos ejecutan **con el token del usuario que pregunta**, nunca con el del
core. Esa es la diferencia que hace que el mensaje salga firmado por quien lo
escribió.

Solo conversaciones **uno a uno** en esta versión.

### Pieza 3 — Dos cambios al core

**Corrección de la primera versión de este documento**, que decía que el único
cambio al core era el hook de push. No es cierto, y se descubrió al revisar el
SDK antes de planificar.

**3a. OAuth por usuario en el cliente de Bitrix.** El SDK le expone al plugin
`call`, `callRaw` y `callAll`, todos con el token global de la aplicación, y —
correctamente— nunca el `clientSecret`. Sin el secreto el plugin no puede
canjear un código de autorización por tokens. El cliente de Bitrix del core gana
cuatro métodos, expuestos en `ctx.bitrix`:

```ts
userAuthorizeUrl(redirectUri: string, state: string): string;
exchangeUserCode(code: string, redirectUri: string): Promise<BitrixUserTokens>;
refreshUserToken(refreshToken: string): Promise<BitrixUserTokens>;
callAsUser<T>(accessToken: string, method: string, params?: Record<string, unknown>): Promise<T>;
```

El secreto se queda en el core. Los tokens de cada persona viven en el plugin
(Pieza 1). Es la división correcta: el cliente de Bitrix es responsabilidad del
core según el CLAUDE.md, y los datos de cada usuario son del plugin que los usa.

**3b. Hook genérico de push.** `PushService` gana un
`registerAction('core.push.send', …)` que cualquier plugin pueda disparar con
`{ userId, title, body, url }`.

**3c. Autorización de dispositivo.** La vinculación por código (Pieza 6)
termina emitiendo un JWT para la app de escritorio, y **un plugin no puede
emitir tokens**: el SDK solo le da `requireAuth`, que verifica. Así que el
flujo vive en el módulo de autenticación del core, que es además su lugar. Es
el patrón estándar de *device authorization grant* (RFC 8628):

| Endpoint | Auth | Qué hace |
|---|---|---|
| `POST /auth/device/start` | pública | Devuelve `userCode` (6 caracteres), `deviceCode` (secreto, largo) y vencimiento |
| `POST /auth/device/confirm` | logueado | La persona confirma un `userCode` desde la web |
| `POST /auth/device/token` | pública | La app canjea su `deviceCode`: `pending` hasta que se confirme, después el JWT **una sola vez** |

Estado en Redis con vencimiento de 5 minutos. La pantalla para teclear el
código va en el frontend de office, que llama al endpoint del core con la
cookie de la persona: así no se toca `apps/web`.

Ninguno de los tres necesita tablas nuevas en el core. Pero los dos tocan el
core, y eso pesa por tres razones verificadas:

- El core se compila en el servidor (`build: context: .`): desplegar obliga a
  reconstruir la imagen del API.
- **El código del core en el servidor no es un repositorio git.** No hay
  historial que permita revertir: cada archivo se respalda antes de tocarlo.
- **El árbol local del core está desfasado** respecto del servidor desde antes
  del 29-abr, y sincronizarlo completo ya rompió el login una vez. Los cambios
  se hacen archivo por archivo, bajando del servidor, editando y subiendo —
  nunca copiando el árbol local entero.

El SDK, además, está **vendorizado** en cada plugin (`vendor/plugin-sdk/`):
tras cambiar sus tipos hay que recopiarlo en office para que compile.

### Pieza 4 — Cómo nos enteramos de un mensaje nuevo

**Preferido: eventos de Bitrix.** `event.bind` sobre `OnImMessageAdd`, para que
Bitrix nos llame en vez de preguntarle. No se pudo comprobar: `event.get`
responde `WRONG_AUTH_TYPE` con webhook, porque exige el token OAuth de la
aplicación. **La primera tarea del plan es verificarlo**, porque decide el
diseño de esta pieza.

**Respaldo: consultar en bucle.** `im.counters.get` por usuario conectado. 23
personas una vez por minuto son 23 peticiones/minuto. El límite de Bitrix ronda
2 por segundo por portal, así que entra — pero **una auditoría sin freno ya
saturó Bitrix y dejó tres pagos varados el 3-ago-2026**. Si se va por acá, las
llamadas van serializadas y con retroceso exponencial, nunca en paralelo.

Llegue como llegue, el aviso sale por dos caminos que ya existen: el **SSE
dirigido** para quien tenga la pantalla abierta, y **Web Push** para el resto.

### Pieza 5 — El widget

**Electron, no Tauri.** Se evaluó Tauri por tamaño (≈5 MB contra ≈150 MB), pero
exige Rust y las Build Tools de Visual Studio, que esta máquina no tiene —
varios GB de instalación previa, y las herramientas acá ya dieron pelea antes.
Electron compila con Node, que ya funciona, y reusa el React y TypeScript del
plugin. Para 23 personas en red interna, 150 MB no es un problema real.

- **Ícono de bandeja** con el color del estado actual. Once colores, los que ya
  define `statusConfig.ts`.
- **Clic** abre un panel con: selector de estado, conversaciones con sin-leer,
  hilo abierto con caja de respuesta, e invitaciones pendientes.
- **Aviso nativo de Windows** al llegar mensaje o invitación.
- Repositorio propio, `vla-widget`, al lado de los demás.

### Pieza 6 — Autenticación del escritorio

El equipo entra con Google, y el flujo de Google redirige a la web, no a una
app de escritorio. **Código de vinculación**, el patrón de los televisores,
implementado en el core (ver 3c):

1. La app pide un código: `POST /auth/device/start` → 6 caracteres a la vista
   y un `deviceCode` secreto que se queda en la app.
2. La persona abre la oficina virtual, ya logueada, y teclea el código.
3. La web confirma; la app, que consulta `/auth/device/token` cada pocos
   segundos, recibe su JWT.

Se eligió sobre las alternativas: el **webview embebido** obliga a leer una
cookie httpOnly desde el proceso nativo, frágil y difícil de depurar; la
**contraseña** no sirve porque nadie tiene una.

El código vive **5 minutos**, es de un solo uso, y se invalida al usarlo.

## Fuera de alcance

- **Chats de grupo.** Solo uno a uno. Bitrix los soporta; el widget no en v1.
- **Adjuntos.** Texto plano.
- **Editar o borrar mensajes.** Se leen y se escriben.
- **macOS y Linux.** Solo Windows.
- **Firma de código.** Decidido: se acepta la advertencia.
- **Actualizaciones automáticas.** Se evalúan cuando haya una segunda versión;
  la primera se instala a mano.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| **1-mar-2027: la API REST sale del plan Professional.** Si la mensajería vive en Bitrix, ese día el widget deja de funcionar, no solo la sincronización | Es una decisión comercial ya pendiente (contratar Vibe+). Este proyecto la vuelve más urgente y hay que decirlo antes de empezar, no después |
| Los eventos de Bitrix podrían no estar disponibles | Primera tarea del plan: verificarlo. Si fallan, se cae al bucle con freno, que sabemos que funciona pero exige cuidado |
| Saturar Bitrix con consultas | Serializado y con retroceso. Precedente real: 3 pagos varados el 3-ago-2026 |
| 23 personas tienen que autorizar su Bitrix | Sin eso no hay mensajería a su nombre. Hay que acompañarlo con instrucciones, y el widget debe explicar el 409 en vez de mostrarse vacío |
| Los cambios al core obligan a reconstruir la imagen del API, sobre un código que no está en git y un árbol local desfasado | Respaldo de cada archivo antes de tocarlo, cambios archivo por archivo, despliegue único antes del plugin. Nunca sincronizar el árbol local completo |
| El `redirect_uri` por usuario apunta al plugin, no al callback que Bitrix ya conoce | Bitrix valida el dominio del redirect contra la aplicación registrada. Hay que verificarlo antes de construir el flujo: es la segunda tarea del plan |
| Primer empaquetado de escritorio del proyecto | Nunca se hizo acá. El primer instalador siempre trae sorpresas; presupuestar holgura |
| 23 credenciales de Bitrix en una tabla en texto plano | Sigue la práctica del core. Queda anotado como deuda explícita, no escondido |

## Preguntas abiertas

1. **¿Se contrata Vibe+?** No bloquea empezar, pero sí define si esto tiene
   futuro más allá de marzo de 2027.
2. **¿Los eventos de Bitrix funcionan con el token OAuth de la aplicación?** Se
   resuelve en la primera tarea.
3. ~~¿Alguien no tiene usuario de Bitrix?~~ **Resuelto el 1-oct-2026: los 23
   activos tienen mapeo.** Nadie queda fuera por esto. (El `synced: 21` que
   devuelve el sync del organigrama es cuántos actualizó esa corrida, no
   cuántos existen.)
