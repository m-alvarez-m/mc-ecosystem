# Guía de desarrollo — Bot Pulso (v1.1)

Primera integración funcional del bot contra un entorno de desarrollo.
Cubre desde crear la aplicación de Discord hasta ver mensajes en el
canal de pruebas.

Lectura previa recomendada:
- [`docs/pulso-bot-design.md`](pulso-bot-design.md) — decisiones de diseño.
- [`docs/adr/008-stack-servicio-pulso.md`](adr/008-stack-servicio-pulso.md)
  · [`009-api-http-superficie-unica-db.md`](adr/009-api-http-superficie-unica-db.md)
  · [`010-consumo-event-store-cursor-id.md`](adr/010-consumo-event-store-cursor-id.md).

---

## Prerrequisitos

- **Node.js LTS** (24 o superior).
- **Docker Desktop** corriendo (para `postgres` + `api` del Event Store).
- **Git Bash** (Windows) o shell POSIX equivalente para comandos con
  variables y `curl`.
- **Cuenta en Discord Developer Portal** con permisos para crear
  aplicaciones. Ver siguiente sección.
- **Bitwarden** (o gestor equivalente) para guardar el token del bot.

## Setup inicial

### 1. Crear la aplicación de Discord

Portal: <https://discord.com/developers/applications>

1. New Application → nombre (`mc-ecosystem-pulso-dev` sugerido).
2. **Bot** section:
   - `Public Bot`: **OFF** (evita que terceros lo agreguen a sus
     servidores).
   - `Requires OAuth2 Code Grant`: **OFF**.
   - `Reset Token` → copiar el token → guardar en Bitwarden inmediatamente.
3. **Privileged Gateway Intents**: dejar TODOS OFF. El bot v1.1 no
   necesita ninguno.
4. **OAuth2 → URL Generator**:
   - Scopes: `bot` + `applications.commands`.
   - Bot permissions: `Send Messages`, `Embed Links`,
     `Read Message History`, `Use Slash Commands`.
   - Copiar la URL generada, abrirla en el navegador, invitar el bot al
     **guild de pruebas** (crear uno si no existe).
5. Anotar:
   - **Guild ID**: click derecho en el server → "Copy Server ID" (con
     Developer Mode activo).
   - **Channel ID**: click derecho en el canal de pruebas destino →
     "Copy Channel ID".

### 2. Configurar variables de entorno

Crear `bot/.env` (o añadir a `infra/.env` si va a correr en el compose
de infra). Variables requeridas:

```
DISCORD_BOT_TOKEN=<pegado desde el Portal>
DISCORD_GUILD_ID=<Guild ID copiado>
DISCORD_EVENTS_CHANNEL_ID=<Channel ID copiado>
PORT=4000
API_BASE_URL=http://localhost:3000
CURSOR_FILE=./data/cursor.json
POLL_INTERVAL_MS=5000
```

Opcional:
```
HTTP_TIMEOUT_MS=10000
```

**Nunca commit `.env`**. `bot/.gitignore` ya lo cubre.

Si te falta cualquier variable requerida, el bot aborta al arrancar con
un mensaje claro indicando cuáles.

### 3. Instalar dependencias

```
cd bot
npm install
```

Ignorar los warnings de `npm audit` sobre vulnerabilidades transitivas
del árbol de discord.js/vitest — no bloquean el bootstrap y se
revisitarán en una sesión de auditoría de deps aparte.

---

## Iniciar el Event Store (postgres + api)

Desde la raíz del monorepo:

```bash
cd /c/Users/ADMIN/Documents/ServidorMinecraftDatabase/mc-ecosystem
docker compose -f infra/docker-compose.dev.yml -p mc-ecosystem up -d postgres api
```

Verificar salud:

```bash
docker compose -p mc-ecosystem ps
curl http://localhost:3000/health
```

Salida esperada del `curl`:
```json
{"status":"ok"}
```

Si `api` no responde: `docker compose -p mc-ecosystem logs api` para
diagnosticar.

---

## Iniciar el bot (modo dev)

Con las env vars configuradas y el Event Store en marcha:

```bash
cd bot
npm run dev
```

Logs esperados (aproximados):

```
[pulso] INFO: Inicio del bot Pulso
[pulso] INFO: Configuracion valida
[pulso] INFO: Servidor health escuchando (port=4000)
[pulso] INFO: Discord conectado y listo (user=mc-ecosystem-pulso-dev#XXXX)
[pulso] INFO: Bot Pulso arrancado
```

En otra terminal:

```bash
curl http://localhost:4000/health
```

Debe devolver `{"status":"ok"}` (200) cuando el cliente Discord ya está
`ready`, o `{"status":"not-ready"}` (503) durante los primeros
segundos del arranque.

Detener con `Ctrl+C` (SIGINT). Logs esperados:

```
[pulso] INFO: Senal recibida, cerrando ordenadamente (signal=SIGINT)
[pulso] INFO: Shutdown limpio completado
```

---

## Verificar que el polling funciona

Con el bot corriendo, en otra terminal:

**a) Cursor inicial**

Antes del primer evento, el archivo `CURSOR_FILE` no existe (el bot
arranca desde `after_id=<vacío>` según su política — ver ADR-010
principio 8).

**b) Cadencia de polls**

El polling engine consulta cada `POLL_INTERVAL_MS`. En logs del bot no
verás ruido por defecto (no imprime cada poll). Para verificar
actividad: revisar accesos en logs de `api`:

```bash
docker compose -p mc-ecosystem logs api --tail 20 | grep GET
```

Deberías ver `GET /events?after_id=...` a intervalo regular.

**c) Cursor tras un evento**

Después de insertar un evento (siguiente sección) y esperar un ciclo
de poll, el archivo `CURSOR_FILE` existe y contiene el `id` del último
evento procesado:

```bash
cat ./data/cursor.json
# {"event_id":"42","updated_at":"2026-07-27T22:00:00.000Z"}
```

---

## Generar eventos de prueba

Los eventos se insertan vía `POST /events` en el `api` (mismo endpoint
que usa `EventCollector`). El bot los descubrirá en el próximo poll.

Helper para generar un `event_uuid` en Git Bash:

```bash
UUID() { python -c "import uuid; print(uuid.uuid4())"; }
# o si no hay python:
UUID() { cat /proc/sys/kernel/random/uuid; }
```

Timestamp UTC:

```bash
TS() { date -u +%Y-%m-%dT%H:%M:%SZ; }
```

Ejemplo genérico:

```bash
curl -X POST http://localhost:3000/events \
  -H "Content-Type: application/json" \
  -d "{
    \"event_uuid\": \"$(UUID)\",
    \"type\": \"server.start\",
    \"v\": 1,
    \"ts\": \"$(TS)\",
    \"data\": {}
  }"
```

Respuesta esperada:
```json
{"id":"<int>","received_at":"..."}
```

Esperar `POLL_INTERVAL_MS` (5 s por default) → debería aparecer el
mensaje en el canal de pruebas.

---

## ⚠️ Discrepancia conocida entre tipos de evento del bot y del catálogo

**Importante antes de probar handlers específicos.**

El bot v1.1 se implementó con tipos "conceptuales" (`player.join`,
`server.tps`, `server.backup`, etc.). Estos tipos NO coinciden con los
que `EventCollector` emite hoy según [`docs/event-catalog.md`]
(event-catalog.md).

Comparativa:

| Bot registra (`compose.ts`) | Catálogo emite (`event-catalog.md`) | Match |
|---|---|---|
| `server.start` | `server.start` | ✅ |
| `server.stop` | `server.stop` | ✅ |
| `player.death` | `player.death` | ✅ (tipo) / ⚠️ (payload — ver abajo) |
| `player.join` | `session.start` | ❌ |
| `player.leave` | `session.end` | ❌ |
| `player.advancement` | `advancement.done` | ❌ |
| `player.chat` | `chat.message` | ❌ |
| `server.tps` | `server.tps_sample` | ❌ |
| `server.backup` | `backup.done` | ❌ |

**Consecuencia en producción real**: cuando `EventCollector` esté
activo emitiendo con los tipos del catálogo, sólo `server.start`,
`server.stop` (y `player.death` con caveat de payload) llegarán a un
handler. Los otros 6 caerán silenciosamente (no hay `onUnknown` hook
configurado).

**Consecuencia adicional del payload de `player.death`**: el
`PlayerDeathHandler` espera `data.name`, pero el catálogo emite
`{cause, killer_uuid?, killer_mob?, message}` sin nombre. El nombre
del jugador viaja en la columna `player_uuid` (root del evento). El
handler actual lanzará `MissingPlayerNameError` en producción real →
`HandlerExecutionError` → el cursor no avanza y el evento se re-entrega
indefinidamente hasta que un operador intervenga.

**En este entorno de desarrollo**: para probar los handlers ahora
mismo, INSERTAR EVENTOS CON LOS TIPOS DEL BOT (columna izquierda), no
del catálogo. Los eventos insertados a mano con `player.join`,
`player.chat`, etc. sí llegarán a sus handlers. Ver checklist abajo.

**Cómo cerrar el gap** — en sesión aparte, no en ésta:
- **Ruta A** *(recomendada)*: renombrar `EVENT_TYPE` en cada handler
  a su equivalente del catálogo, adaptar la extracción de `name` (via
  lookup UUID→nombre contra `api /players/*` o tabla `players`),
  actualizar tests. Superficie de cambio acotada al bot.
- **Ruta B**: modificar `EventCollector` para emitir tipos duales o
  migrar los nombres del catálogo. Requiere trabajo Java + redespliegue
  del plugin.

## Checklist de verificación por tipo de evento

Para cada tipo, un `curl` que genera el evento y el mensaje esperado
en Discord. Usar los tipos que el bot conoce (`player.join`, etc.);
ver la advertencia previa.

Requiere las funciones `UUID` y `TS` definidas arriba.

### ✅ server.start
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"server.start\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{}}"
```
**Discord**: `**Servidor iniciado**` / `Servidor iniciado correctamente.`

### ✅ server.stop
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"server.stop\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{}}"
```
**Discord**: `**Servidor detenido**` / `Servidor detenido correctamente.`

### ✅ player.join
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"player.join\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"name\":\"Vancorbus\"}}"
```
**Discord**: `**Jugador conectado**` / `Vancorbus se ha unido al servidor.`

### ✅ player.leave
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"player.leave\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"name\":\"Vancorbus\"}}"
```
**Discord**: `**Jugador desconectado**` / `Vancorbus ha salido del servidor.`

### ✅ player.death
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"player.death\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"name\":\"Vancorbus\",\"cause\":\"un Creeper\"}}"
```
**Discord**: `**Jugador eliminado**` / `Vancorbus ha muerto por un Creeper.`

Sin causa:
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"player.death\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"name\":\"Vancorbus\"}}"
```
**Discord**: `**Jugador eliminado**` / `Vancorbus ha muerto.`

### ✅ player.advancement
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"player.advancement\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"name\":\"Vancorbus\",\"advancement\":\"Enter the Nether\"}}"
```
**Discord**: `**Nuevo avance**` / `Vancorbus ha conseguido el avance: Enter the Nether.`

### ✅ player.chat
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"player.chat\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"name\":\"Vancorbus\",\"message\":\"hola mundo\"}}"
```
**Discord**: `**Chat**` / `Vancorbus: hola mundo`

### ✅ server.tps
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"server.tps\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"tps\":19.87}}"
```
**Discord**: `**Estado del servidor**` / `TPS actual: 19.87`

### ✅ server.backup
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"server.backup\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"kind\":\"world\",\"size_mb\":223,\"ok\":true}}"
```
**Discord**: `**Respaldo completado**` / `Tipo: world. Tamaño: 223 MB. Estado: exitoso.`

Con `ok:false`:
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"server.backup\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"kind\":\"db\",\"size_mb\":5,\"ok\":false}}"
```
**Discord**: `**Respaldo completado**` / `Tipo: db. Tamaño: 5 MB. Estado: fallido.`

### Tipos NO manejados (el bot los ignora silenciosamente)

Cualquier evento con `type` distinto a los 9 anteriores no dispara
ningún handler. `EventCollector` en producción emite muchos más
(`block.break`, `position.sample`, `chunk.first_load`, etc.) — todos
se saltan sin ruido, como está diseñado (ver `EventDispatcher.dispatch`).

---

## Verificar cursor y persistencia

Después de generar algunos eventos:

```bash
cat ./data/cursor.json
```

El `event_id` debe corresponder al `id` del último evento POSTeado
con éxito. `updated_at` debe ser reciente.

Si detienes el bot (`Ctrl+C`), lo relanzas, y **no** POSTeas eventos
nuevos: el bot arranca, hace un poll, y no publica nada nuevo (el
cursor está al día).

Si POSTeas eventos MIENTRAS el bot está apagado, al reiniciarlo se
procesarán en la próxima iteración (garantía de al-menos-una entrega
según ADR-010).

Para forzar un replay total (desde el cutoff de ADR-007):

```bash
rm ./data/cursor.json  # Bot arranca sin cursor → política del consumer
```

Ojo: con el bot actual, "sin cursor" significa "empieza pidiendo sin
`after_id`", que la api interpreta según su default. Si la api
devuelve todo el histórico → floodeo del canal Discord. Para producción
esta política se debe pre-seedear con `after_id = MAX(id)` (skip to
latest) — ver ADR-010 principio 8.

---

## Manual E2E — resultado de esta sesión

**No ejecutado end-to-end en esta sesión**. La ejecución completa requiere:

- Aplicación Discord creada + token en `.env` (paso del dueño).
- Bot invitado a un guild + channel ID configurado (paso del dueño).
- Docker Desktop corriendo + `docker compose up postgres api`.
- `cd bot && npm run dev`.
- Ejercitar los 9 `curl` del checklist y observar el canal Discord.

**Sí validado en esta sesión**:

- ✅ `npm run typecheck`: clean
- ✅ `npm run build`: `dist/` completo generado
- ✅ `npm run test`: 194/194 tests unitarios pasando (17 test files)

**Registro del primer E2E real** (a completar por el operador):

| Fecha | Operador | Eventos probados / observados en Discord | Notas |
|---|---|---|---|
| — | — | — | pendiente |

---

## Referencias cruzadas

- Bootstrap del bot: [`bot/README.md`](../bot/README.md)
- Diseño arquitectónico: [`docs/pulso-bot-design.md`](pulso-bot-design.md)
- ADRs 008 / 009 / 010: [`docs/adr/`](adr/)
- Catálogo de eventos productores: [`docs/event-catalog.md`](event-catalog.md)
- Guía para añadir eventos nuevos: [`docs/adding-new-event.md`](adding-new-event.md)
