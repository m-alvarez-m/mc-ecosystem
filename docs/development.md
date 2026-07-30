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
TPS_ALERT_THRESHOLD=18
```

`TPS_ALERT_THRESHOLD` (default `18`): TPS por debajo del cual el bot
publica alerta de degradación. Samples con TPS ≥ umbral son silencio
absoluto (evita spam del sample cada 60s). Acepta decimales
(`17.5`, `15.8`).

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

## Estado de compatibilidad con el catálogo

Los identificadores de evento del bot **ya están alineados** con
`docs/event-catalog.md`. Cada handler registra el `EVENT_TYPE` que
`EventCollector` realmente emite:

| Handler | `EVENT_TYPE` (catálogo) | Payload alineado |
|---|---|---|
| ServerStartedHandler | `server.start` | ✅ (handler no consume payload) |
| ServerStoppedHandler | `server.stop` | ✅ (handler no consume payload) |
| PlayerJoinedHandler | `session.start` | ❌ falta `data.name` en catálogo (solo `ip_hash`) |
| PlayerLeftHandler | `session.end` | ❌ falta `data.name` en catálogo (solo `duration_s`, `reason`) |
| PlayerDeathHandler | `player.death` | ❌ falta `data.name` en catálogo (solo `cause`, `killer_*`, `message`) |
| AdvancementHandler | `advancement.done` | ❌ falta `data.name` en catálogo (solo `advancement`) |
| ChatHandler | `chat.message` | ❌ falta `data.name` y el mensaje llega como `content`, no `message` |
| TpsHandler | `server.tps_sample` | ❌ el TPS llega como `tps_1m` (float), no como `tps` |
| BackupHandler | `backup.done` | ✅ full match (`kind`, `size_mb`, `ok`) |

**Consecuencia práctica en producción real**: sólo funcionan
end-to-end sin más ajustes:

- `server.start` → publica "Servidor iniciado"
- `server.stop` → publica "Servidor detenido"
- `backup.done` → publica el resumen del respaldo

Los otros 6 handlers **reciben el evento** (el dispatcher los enruta
correctamente ahora), pero **lanzan error tipado** (`MissingPlayerNameError`,
`InvalidTpsError`, `MissingChatMessageError`) porque los campos que
esperan no vienen en el payload emitido por `EventCollector`. Cada
error se propaga como `HandlerExecutionError` → el polling engine NO
avanza el cursor → el mismo evento se re-entrega indefinidamente
hasta que se resuelvan las incompatibilidades de payload.

### Incompatibilidades de payload restantes (fuera de scope de la alineación)

Para los 6 handlers arriba, el gap se cierra con alguna de estas rutas
(cada una es sesión propia):

1. **Nombre del jugador**: el catálogo pasa `player_uuid` en el
   root del evento; los handlers esperan `data.name`. Opciones:
   - Endpoint nuevo en `api`: `GET /players/{uuid}` que devuelve
     `{name}`. Handlers hacen lookup UUID→name antes de publicar.
     Añade una round-trip HTTP por evento (cacheable).
   - Enriquecer el evento en el productor: `EventCollector` incluye
     `data.name` al emitir. Ruta más limpia pero requiere plugin work.
   - Enriquecimiento en la api: middleware que resuelve `player_uuid`
     → `name` y añade `data.name` antes de que el bot lea el evento.
     Descarta separación de responsabilidades (api mutando eventos).
2. **Campo `chat.message.data.message`**: catálogo lo llama `content`.
   Trivial de renombrar en `ChatHandler.extractChatMessage()`.
3. **Campo `server.tps_sample.data.tps`**: catálogo lo llama `tps_1m`.
   Trivial de renombrar en `TpsHandler.extractTps()`.

Puntos 2 y 3 son fixes de una línea cada uno; podrían agruparse en una
sesión corta de "field name alignment". El punto 1 es el más
significativo y depende de la ruta arquitectónica que decida el dueño.

### Para probar en dev mientras tanto

En dev, los `curl` del checklist abajo insertan eventos DIRECTAMENTE
por `POST /events` con los campos que el bot espera (`data.name`,
`data.message`, `data.tps`, etc.). Estos eventos sí llegan
correctamente a los handlers, se procesan sin error, y publican en
Discord. Es una prueba VÁLIDA del pipeline del bot, aunque no
representa fielmente lo que emitirá `EventCollector` sin las
correcciones de payload.

## Checklist de verificación por tipo de evento

Para cada tipo, un `curl` que genera el evento y el mensaje esperado
en Discord. Los `type` corresponden al catálogo (los mismos que el
bot registra ahora). Los payloads son los que el HANDLER espera —
algunos difieren del catálogo real, ver sección anterior.

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

### ✅ session.start (jugador conectado)
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"session.start\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"name\":\"Vancorbus\"}}"
```
**Discord**: `**Jugador conectado**` / `Vancorbus se ha unido al servidor.`

### ✅ session.end (jugador desconectado)
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"session.end\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"name\":\"Vancorbus\"}}"
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

### ✅ advancement.done
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"advancement.done\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"name\":\"Vancorbus\",\"advancement\":\"Enter the Nether\"}}"
```
**Discord**: `**Nuevo avance**` / `Vancorbus ha conseguido el avance: Enter the Nether.`

### ✅ chat.message
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"chat.message\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"name\":\"Vancorbus\",\"message\":\"hola mundo\"}}"
```
**Discord**: `**Chat**` / `Vancorbus: hola mundo`

### ✅ server.tps_sample
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"server.tps_sample\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"tps\":19.87}}"
```
**Discord**: `**Estado del servidor**` / `TPS actual: 19.87`

### ✅ backup.done
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"backup.done\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"kind\":\"world\",\"size_mb\":223,\"ok\":true}}"
```
**Discord**: `**Respaldo completado**` / `Tipo: world. Tamaño: 223 MB. Estado: exitoso.`

Con `ok:false`:
```bash
curl -X POST http://localhost:3000/events -H "Content-Type: application/json" \
  -d "{\"event_uuid\":\"$(UUID)\",\"type\":\"backup.done\",\"v\":1,\"ts\":\"$(TS)\",\"data\":{\"kind\":\"db\",\"size_mb\":5,\"ok\":false}}"
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
