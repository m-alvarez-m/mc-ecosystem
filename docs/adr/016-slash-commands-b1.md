# ADR-016: Slash commands del bot Pulso (FASE B.1) — patrón consulta-solo, ephemeral, registro por-guild

- **Fecha**: 2026-08-11
- **Estado**: aceptado
- **Fase del roadmap**: B.1 · P2-1 (ver `docs/roadmap-consolidacion-v1.2-v2.0.md:14`)

## Contexto

Al cerrar FASE A (commits `7d5a56a`, `c43d4ee`, `3fbc223`, `097b094`,
`69ede32`, `3b2a41e`; CI verde en run `31465267676`), el bot Pulso
consolidó su rol de **cronista reactivo**: consume el Event Store,
resiste fallos silenciosos (ADR-013), y publica narrativa
determinista al canal principal de Discord. La cobertura funcional
llegó a "todo lo que ocurre en el servidor Minecraft aparece en
Discord". Lo que **no** puede el bot hoy es responder consultas bajo
demanda — un miembro del Discord que se pregunta "¿está el server
up?" o "¿quién está jugando?" tiene que abrirlo, o esperar el
próximo evento narrado.

FASE B.1 del roadmap consolidado convierte al bot de "100% reactivo"
a "consultable bajo demanda desde Discord". Alcance estricto: **tres
slash commands — `/players`, `/tps`, `/status`. Nada más.**
Cualquier otro comando (bridge de chat, comandos administrativos,
paginación, auto-refresh) queda fuera de B.1 por disciplina de
alcance del roadmap.

Este ADR consolida las siete decisiones de diseño (D1-D7)
consensuadas antes de la implementación, más los seis matices
operativos añadidos durante la aprobación bloque-por-bloque.

## Problema

Introducir tres slash commands en un bot Discord parece trivial en
apariencia, pero cruza varias fronteras institucionales del
ecosistema donde una decisión ingenua rompería invariantes ya
firmados:

- El bot **no habla RCON**: hasta hoy, sólo el contenedor
  `minecraft-prod` posee el `RCON_PASSWORD` (ver la lista de
  secretos en la checklist de nacimiento del mundo real, item 1
  del runbook). Meter RCON en el bot amplía la superficie de
  ataque y duplica una capacidad que ya tiene otro contenedor.
- El bot ya practica **rechazo de datos rancios** para estado
  (`bot/src/handlers/tps-handler.ts` — "publicar TPS antiguo es
  mentir", lección BUG-02A §3). Un `/tps` slash command que
  responda con un sample de hace 10 minutos violaría exactamente
  la misma disciplina.
- El bot ya sigue la disciplina **"solo consulta al api, nunca a
  la DB"** (ADR-009 · api HTTP como superficie única, y todo el
  código en `bot/src/eventstore/client.ts`). Un slash command que
  abriera un pool Postgres nuevo sería una excepción sin motivo.
- Discord rate-limita la registración global de comandos (~1 h de
  propagación); el registro por-guild propaga instantáneo pero
  requiere disciplina explícita. Automatizarlo en el arranque del
  bot introduce el mismo patrón de "olvido institucional" que
  motivó ADR-014 (checklist de nacimiento normativa).
- La regla anti-flakiness institucionalizada en el commit `212d68f`
  (`docs/runbook.md` · sub-sección "Fix post-FASE A · flakiness
  institucional en tests de catálogos") aplica también a los tests
  de slash commands: cualquier iteración sobre variantes, RNG o
  tiempo real requiere mock determinista.

Un ADR consolidado antes de escribir código deja las siete
decisiones auditables y evita re-litigarlas durante la
implementación.

## Decisión

### D1 · Stack — discord.js v14, sin cambios

Se mantiene `discord.js` ^14.16.0 (ya instalado en
`bot/package.json:15`). El `Client` existente en
`bot/src/discord/client.ts:15` usa `GatewayIntentBits.Guilds`, el
único intent que los slash commands requieren; no se activa
`MESSAGE CONTENT` ni ningún otro privilegiado. Cero cambios en el
Portal de Discord.

Alternativas descartadas: `@discordjs/core` (pierde
`SlashCommandBuilder` y helpers, cero beneficio para 3 comandos);
`necord` / frameworks tipo NestJS (overkill); `discordeno` /
`harmony` (runtime Deno, no aplica al monorepo Node).

### D2 · Registro por script separado, no auto-registro al arrancar

Se añade un script npm (nombre tentativo `register-commands`)
ejecutado manualmente cuando cambian comandos. NO se registran al
arrancar el bot. Los comandos se publican a **UN guild específico
identificado por `DISCORD_GUILD_ID`**, no globalmente.

Matices operativos obligatorios del script:

- **Fail-fast de configuración**: valida que `bot/.env` tiene las
  3 vars requeridas — `DISCORD_BOT_TOKEN` (auth con Discord),
  `DISCORD_CLIENT_ID` (application id para el path del PUT), y
  `DISCORD_GUILD_ID` (guild destino) — presentes antes de tocar
  Discord. Si falta cualquiera, aborta con un mensaje explícito
  nombrando la variable faltante — cero llamadas a la API con
  configuración parcial.
- **Log de evidencia**: antes de publicar, imprime los nombres de
  comandos que va a registrar; después de publicar, imprime los
  IDs devueltos por Discord. Esto deja rastro auditable de "qué
  quedó registrado en el guild y cuándo".
- **Idempotencia explícita**: `PUT /applications/{app}/guilds/{guild}/commands`
  reemplaza la lista completa (no acumula). El script documenta
  este comportamiento en su docstring y en el log ("antes: [X
  comandos] → después: [Y comandos]"). No hay riesgo de
  duplicados por ejecuciones repetidas.
- **Referencia en runbook**: se añade una sección "Registro de
  slash commands" al runbook con el comando exacto a ejecutar
  (`npm run register-commands` desde `bot/`), las precondiciones
  (`.env` cargado con las dos vars), y el output esperado.

Motivo: los tradeoffs (registrado auto-al-arrancar vs manual)
favorecen el manual porque (a) los comandos cambian con muy poca
frecuencia comparado con `docker restart`, (b) auto-registrar
gasta rate-limit por deploy, (c) por-guild propaga instantáneo
mientras global propaga ~1 h (ver `docs/pulso-bot-design.md:443`,
Risk #8 ya identificado). El script separado hace explícito y
auditable un cambio que auto-al-arrancar dejaría implícito.

### D3 · Contrato por comando

#### `/players`

**Qué devuelve**: lista de jugadores actualmente online, ordenada
por tiempo de sesión descendente (el que lleva más tiempo primero).
Sin límite explícito (esperados ≤10 en el foreseeable future del
servidor). No incluye jugadores offline — quien quiere historia de
un jugador consulta otra vía.

**Fuente de datos**: **nuevo endpoint** `GET /players/online` en el
api. Deriva de `session.start` sin `session.end` correspondiente
más reciente por jugador. Motivo de crearlo en vez de consultar
directo al event store desde el bot: mantiene la disciplina
"bot → api, nunca bot → DB" (ADR-009), y el endpoint es reusable
por Genesis (v2.0 Insight) cuando llegue FASE D.

**Formato temporal por jugador (matiz aprobado)**: para "última
visita" o inicio de sesión, el output usa dos formatos según
umbral:

- Si `hace < 24 h`: tiempo relativo — "hace 3h 12m", "hace 45m".
- Si `hace >= 24 h`: fecha absoluta en zona `America/Monterrey` —
  "vier 8 nov a las 21:32".

Esta bifurcación evita el sinsentido de "hace 47 días" (poco
legible) y el ruido de "vier 8 nov a las 21:32" cuando el jugador
se conectó hace 15 minutos.

**TTL de cache**: **10 s**. El polling del bot es `POLL_INTERVAL_MS=5000`
(verificado en `bot/.env:9` y `bot/src/config/env.ts:76`). Aplicando
la regla operativa "TTL = 2× polling redondeado a decena", queda 10 s.
Justificación: si dos usuarios ejecutan `/players` con 3 s de
diferencia, la segunda ejecución no debería re-consultar el api
para datos que van a coincidir con la primera con probabilidad ~1.
El TTL 10 s cubre esa ventana sin ocultar cambios reales que
tarden más de 5 s en propagarse por el pipeline.

#### `/tps`

**Qué devuelve**: TPS del último minuto reportado por el server, o
un fallback claro cuando el dato está rancio.

**Fuente de datos**: **evento `server.tps_sample` más reciente**
consultado vía api (nuevo endpoint derivado o reutilizando
`GET /events?types=server.tps_sample&limit=1` según lo que sea más
limpio en implementación; queda para decidir en el diff, ambos
caminos son coherentes con ADR-009).

**Rechazo de datos rancios**: se reusa exactamente el patrón de
`bot/src/handlers/tps-handler.ts` (la lección de BUG-02A §3, "un
sample delayed indicando TPS 5 llegando 30 min tarde no debe
publicarse como estado actual"). Umbral inicial: **90 s**.

- Sample con `now - ts < 90 s` → `TPS 1m: 19.84` con timestamp
  relativo (`hace 12s`).
- Sample con `now - ts >= 90 s` → `TPS no disponible (último
  sample de hace X)`.
- Sin sample en la tabla → `TPS no disponible (sin samples aún)`.

**Alternativa descartada explícitamente**: RCON directo desde el
bot al server (`docker exec … rcon-cli tps`). Motivos: (a) forzaría
al bot a conocer el `RCON_PASSWORD`, ampliando la superficie de
credenciales innecesariamente; (b) bloquea el thread principal del
server con cada consulta; (c) el sample ya está pre-calculado por
el plugin en la tabla `events` — leerlo es gratis y no interfiere
con el server vivo.

#### `/status`

**Qué devuelve**: nueve líneas de salud consolidada del ecosistema
completo (server + pipeline + bot). Cubre las preguntas más
frecuentes en un solo comando y hace visible por default lo que
sin él quedaría enterrado en logs o dashboards.

Las 9 líneas:

1. **Server Minecraft online/offline** — derivado de si el último
   evento `server.start` no tiene un `server.stop` posterior.
2. **Uptime del server** — tiempo desde el último `server.start`
   (o "N/A" si offline).
3. **Jugadores online** — número (sin lista; quien quiere lista
   usa `/players`).
4. **TPS 1m** — con la misma guardia de freshness que `/tps`
   (fresh / stale / N/A).
5. **DLQ pendientes** — número de entradas no reprocesadas en
   `dead_letter_events`, vía `GET /admin/dlq/pending-count` (ya
   existente en `api/src/routes/dlq.ts:139`). **Evidencia
   silenciosa del ADR-013**: si el número es >0, un handler está
   fallando repetidamente y merece atención; si es 0, la
   resiliencia está callada porque no la ha necesitado.
6. **Último evento procesado** — `event_id + tipo + hace X` (tomado
   del cursor del bot o del último dispatch exitoso).
7. **Última alerta de TPS bajo** — timestamp de la última publicación
   del `TpsHandler` en `dispatch-context`, o "sin alertas recientes"
   si no hubo en las últimas 24 h.
8. **Bot version + uptime del bot** — versión desde `package.json`
   (`0.1.0` hoy), uptime desde `process.uptime()`.
9. **Cursor del bot vs latest_id del api** — `event_id actual /
   latest_id`, con el lag calculado en número de eventos. Detecta
   atascos (lección Incidente 001) antes de que el usuario los
   note por ausencia de narrativa.

**Ampliación deliberada sobre la propuesta inicial**: el diseño
inicial de este ADR proponía 4 líneas (server on/off, uptime,
count, TPS). El aprobante extendió a 9 líneas incluyendo DLQ
pendientes como "evidencia silenciosa del ADR-013". La extensión
se acepta por dos razones: (a) todas las líneas nuevas leen de
fuentes ya existentes (endpoints del api, `process`, cursor
interno del bot) — no obligan a construir infraestructura nueva;
(b) consolidar "salud del ecosistema" en un solo comando reduce la
necesidad de comandos ulteriores tipo `/dlq-status`, `/bot-info`,
manteniendo la disciplina "3 comandos, nada más" de B.1.

**Explícitamente fuera de `/status`**: backup exitoso (vive en el
contenedor `mc-ecosystem-backup-1`, no fluye por `events`;
integrarlo obligaría a leer restic snapshot list o emitir un evento
`backup.completed`, ambos ampliaciones de alcance). Queda para
B.2+ o para un `/backup-status` propio si aparece la necesidad.

### D4 · Permisos — abiertos a todos los miembros del guild

Los tres comandos son **read-only e inocuos**: no mutan estado del
server Minecraft, no revelan secretos, no permiten
teleport/kick/ban. Cualquier miembro del guild Discord puede
ejecutarlos.

**Consistencia con la decisión de dueño del Incidente 003**: el
runbook establece que Vancorbus es OP permanente y los amigos
(Pacman26, Elrid) NO reciben OP; los amigos pueden jugar con
permisos granulares por rol. Aplicar least-privilege a slash
commands read-only sería sobreactuación defensiva —
`/players` y `/status` son exactamente el tipo de consulta que un
amigo hace sin pedir permiso.

**Precedente establecido para el futuro**: `lectura = abierto,
mutación = admin`. Cuando llegue un comando que sí mute (ej.
`/prune-events`, `/replay-dlq`, `/give`), ese comando llevará
`default_member_permissions: PermissionFlagsBits.Administrator`. La
regla queda documentada aquí para no re-litigarla más adelante.

### D5 · Ephemeral por default en los 3 comandos

Los 3 comandos responden con `interaction.reply({ ..., ephemeral: true })`.
Sólo el usuario que ejecutó el comando ve la respuesta.

Motivos:

- Son consultas de estado privadas, no anuncios. El canal principal
  del bot es un flujo narrativo (deaths, milestones, crafts). Meter
  respuestas de status a ese flujo lo ensucia.
- Elimina el patrón "5 usuarios preguntan `/status` en sucesión y el
  canal queda con 5 embeds idénticos".
- Reduce presión de moderación (nadie tiene que borrar mensajes de
  bot repetitivos).

**Matiz obligatorio (aprobado)**: el diseño de los embeds NO
depende de capacidades que ephemeral no ofrece. Específicamente:

- **Sin auto-refresh del contenido** — el mensaje es un snapshot
  del momento de la ejecución. Discord no permite "actualizar
  ephemeral" desde otro contexto.
- **Sin reacciones para paginación** — los 3 comandos caben en un
  solo embed corto; no hay flujo multi-página.
- **Sin persistencia después de cerrar Discord** — ephemeral
  desaparece del cliente al reiniciar. Nadie debe apoyarse en
  "abro el `/status` de ayer" — se ejecuta de nuevo.

**Escape hatch documentado**: si alguna vez aparece la necesidad
"comparto `/players` con el canal", ese será un comando distinto
(`/players-public` o un flag `share:true`) NO ephemeral, con su
propio ADR o al menos su propia decisión explícita. Ephemeral no
se convierte en público a mitad del ciclo de vida del comando.

### D6 · Tests — mock manual de `ChatInputCommandInteraction`, sin biblioteca externa

Cada handler de slash command se implementa como una función
`handle(interaction, deps): Promise<void>` con dependencias
inyectadas (api client, logger, `now: () => Date`). Los tests
construyen a mano un `ChatInputCommandInteraction` mock:

- `options.getString/getInteger/…` como `vi.fn()` con valores
  fijos por caso.
- `reply/deferReply/editReply` como `vi.fn().mockResolvedValue(undefined)`.
- Aserciones sobre `interaction.reply.mock.calls[0][0]` contra
  `{ content, ephemeral: true }` o `{ embeds: […], ephemeral: true }`.

**Cobertura mínima por comando**:

- **Happy path** con datos frescos → embed correcto, `ephemeral: true`.
- **Error del api** (timeout, 5xx) → mensaje de fallback claro
  ("no puedo consultar el servidor ahora, reintentá en un momento"),
  sin lanzar excepción no capturada.
- **Freshness stale** donde aplique (`/tps`, `/status` para las
  líneas 4 y 6-9) → mensaje de "no disponible" o "hace X" según
  corresponda.

**Test del builder**: verificar que el `SlashCommandBuilder` de
cada comando declara el nombre exacto (`players`, `tps`, `status`)
y NO exige opciones obligatorias (los 3 comandos no aceptan
parámetros). Detecta typos de contrato antes del deploy manual.

**Regla institucional anti-flakiness — cita textual del estándar
adoptado por el bot** (heredada del cierre de FASE A, commit
`212d68f`, `docs/runbook.md` sub-sección "Fix post-FASE A ·
flakiness institucional en tests de catálogos"):

> Regla institucional (heredada del cierre de FASE A): cualquier
> test que use RNG, tiempo real, o iteración sobre variantes debe
> mockear la fuente de no-determinismo. `it.each` con
> `Math.random()` sin mock queda prohibido como patrón.

Alcance vinculante en este ADR: la regla se extiende al bot completo
desde este documento en adelante, no sólo a los tests de catálogos
donde nació. Cualquier PR posterior que agregue tests puede citar
esta sección de ADR-016 como fuente normativa.

Aplicación concreta a B.1: los handlers de `/tps` y `/status` usan
`Date.now()` para computar freshness. Se inyecta `now: () => Date`
como dependencia; los tests fijan el reloj con `now: () => new Date("2026-08-11T12:00:00Z")`.
Cero dependencia de `Date.now()` real, cero flakiness. Si algún
comando futuro necesita RNG, se sigue la misma disciplina:
inyección + mock, o iteración exhaustiva.

**CI**: los tests entran automáticamente al job "Bot Pulso" del
workflow `main CI` (ya existente y verde). No se añade workflow
nuevo — sólo se verifica que el total de tests crece y sigue
verde tras el commit de B.1.

### D7 · Número de ADR — 016

Se firma como **ADR-016**. Estado de la numeración al 2026-08-11:

- ADR-011, 012, 013: firmados en FASE A.
- ADR-014: firmado en commit `69ede32` (checklist de nacimiento
  institucional).
- **ADR-015: reservado** para FASE D.1 (Genesis → v2.0 Insight),
  ver la sección "Corrección de numeración" del ADR-014 y
  `docs/roadmap-consolidacion-v1.2-v2.0.md:26`.
- **ADR-016: libre → este documento**.

Se firma junto con el commit de B.1 (no antes, no después) para
evitar el patrón de "ADR reservado sin escribir" que causó la
colisión de ADR-013 detectada durante FASE A.

## Verificación de runtime

En línea con ADR-011 ("el runtime siempre debe coincidir con el
código") y con el checkpoint CP-D del ADR-014 ("verificación de
runtime tras cualquier fase que toque volúmenes, plugins o env"),
el cierre de B.1 requiere evidencia concreta con comandos
reproducibles y salida esperada. Ninguno de estos pasos es opcional
para declarar B.1 cerrada.

**Correspondencia con los checkpoints institucionales del ADR-014.**
Los 7 checkpoints operacionales de este ADR (CP-1 a CP-7) NO son
una segunda taxonomía paralela: cada uno instancia uno o más de
los 4 checkpoints normativos que ADR-014 fijó como estado esperado
del mundo real y de cualquier fase posterior que toque
volúmenes/plugins/env/secretos. La tabla explicita la relación:

| CP operacional (este ADR)                | CP institucional (ADR-014)                                                                                          | Cómo instancia el principio                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CP-1** · preconditions del `bot/.env`  | **CP-C** (secretos de `.env` presentes con formato correcto)                                                        | `grep -c '^VAR='` sobre las 3 vars requeridas — `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`. Regla anti-quemar-keys aplicada literalmente. |
| **CP-2** · registro efectivo en Discord  | **CP-D** (verificación runtime tras fase que toca env)                                                              | Publicación efectiva contra la superficie externa (Discord) con log de IDs devueltos. Sin este paso, el bot arranca sin comandos disponibles.           |
| **CP-3** · runtime del bot ejecuta el código del último commit | **CP-A** (todos los artefactos propios presentes en el volumen del runtime) + **CP-D** (verificación runtime)                    | `docker exec grep` sobre `/app/dist/` es la versión "artefacto Node en imagen Docker" del principio "el `.jar` esperado está donde el server lo carga". |
| **CP-4** · endpoints del api responden   | **CP-D** (verificación runtime tras fase que toca env, aquí "código nuevo del api")                                 | `curl` real a los 3 endpoints usados por B.1. Un endpoint declarado en git pero no expuesto en runtime es exactamente el fallo que CP-D quiere cerrar.  |
| **CP-5** · SQL de session pairing        | **CP-D** (verificación runtime — fuente de verdad última)                                                           | `psql -c` contra la DB en vivo confirma que la lógica del endpoint coincide con la definición SQL de "online". Sanity end-to-end de la fuente de datos. |
| **CP-6** · ejecución E2E en Discord      | **CP-D** (verificación runtime end-to-end) + **CP-B** (precedente "lectura abierta, mutación admin")                | El único paso que verifica el flujo completo cliente → Discord → bot → api → DB → embed. También verifica que D4 se respeta en la ejecución real.       |
| **CP-7** · CI verde con conteo aumentado | **CP-D** aplicado al pipeline de validación (no al runtime del bot vivo, sino al runtime del validador de código)   | El principio "el runtime del código debe coincidir con lo que git dice" aplica también a CI: sin verde y sin aumento del conteo, la fase no está cerrada. |

Corolario: si en el futuro alguien propone un nuevo checkpoint
operacional para B.1 o para fases posteriores, debe encajar en uno
de los 4 slots normativos de ADR-014 (o abrir un ADR nuevo que
extienda la taxonomía institucional, análogo al que agregaría un
CP-E). No se aceptan checkpoints huérfanos.

### CP-1 · Preconditions del `.env` del bot (fail-fast antes de tocar Discord)

```bash
# Verifica presencia SIN exponer valores (regla anti-quemar-keys
# heredada del paso 1 de la checklist de nacimiento del runbook).
# Cada aplicación tiene su propio .env: bot/.env aquí, no infra/.env
# (decisión existente del proyecto, ver runbook · sección Slash commands).
for var in DISCORD_BOT_TOKEN DISCORD_CLIENT_ID DISCORD_GUILD_ID; do
    count=$(grep -c "^${var}=" mc-ecosystem/bot/.env || echo 0)
    echo "$var → $count (esperado: 1)"
done
```

Salida esperada:

```
DISCORD_BOT_TOKEN → 1 (esperado: 1)
DISCORD_CLIENT_ID → 1 (esperado: 1)
DISCORD_GUILD_ID → 1 (esperado: 1)
```

Si algún conteo ≠ 1, `npm run register-commands` aborta con
mensaje explícito nombrando la variable faltante (matiz D2 ·
fail-fast). Cero llamadas a Discord con configuración parcial.

### CP-2 · Registro efectivo en Discord (por-guild, no global)

```bash
cd mc-ecosystem/bot && npm run register-commands
```

Salida esperada del script (log de evidencia · matiz D2):

```
[register-commands] guild=<DISCORD_GUILD_ID> · antes: 0 comandos
[register-commands] publicando: players, tps, status
[register-commands] PUT /applications/{app}/guilds/{guild}/commands → 200 OK
[register-commands] después: 3 comandos
[register-commands]   players → id=<snowflake-1>
[register-commands]   tps     → id=<snowflake-2>
[register-commands]   status  → id=<snowflake-3>
```

Los 3 IDs devueltos por Discord se quedan en el log como evidencia
auditable. Ejecuciones repetidas son idempotentes (PUT reemplaza la
lista completa; `antes: 3 → después: 3`, mismos IDs).

### CP-3 · Runtime del bot ejecuta el código del último commit (ADR-011)

```bash
# El grep sobre /app/dist/**/*.js debe encontrar el símbolo
# distintivo de los 3 comandos. Cuenta ≥ 3.
docker exec mc-ecosystem-bot-1 sh -c \
    'grep -rc "SlashCommandBuilder" /app/dist/ | grep -v ":0$" | wc -l'
```

Salida esperada: número ≥ 3 (uno por comando). Cero indica que la
imagen del contenedor NO contiene los slash commands aunque el
`git log` diga que sí — el mismo patrón de fallo silencioso que
motivó ADR-011.

Refuerzo con `docker inspect`:

```bash
docker inspect mc-ecosystem-bot-1 --format '{{.Image}}' | \
    xargs docker image inspect --format '{{.Created}}'
```

Salida esperada: timestamp de la imagen posterior al commit de B.1.

### CP-4 · Endpoints del api responden con la forma esperada

`GET /players/online` (nuevo endpoint de B.1):

```bash
curl -sS http://localhost:3000/players/online | jq .
```

Salida esperada (con jugadores online):

```json
{
  "players": [
    {
      "uuid": "71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
      "name": "Vancorbus",
      "session_start_ts": "2026-08-11T14:20:00.000Z"
    }
  ]
}
```

Salida esperada (sin jugadores):

```json
{ "players": [] }
```

`GET /events?types=server.tps_sample&limit=1` (para `/tps` y línea 4
de `/status`):

```bash
curl -sS "http://localhost:3000/events?types=server.tps_sample&limit=1" | jq '.events[0] | {ts, tps: .data.tps_1m}'
```

Salida esperada:

```json
{ "ts": "2026-08-11T14:22:15.000Z", "tps": 19.84 }
```

`GET /admin/dlq/pending-count` (para línea 5 de `/status` ·
evidencia silenciosa ADR-013):

```bash
curl -sS -H "X-Admin-Token: $ADMIN_DLQ_TOKEN" \
    http://localhost:3000/admin/dlq/pending-count | jq .
```

Salida esperada:

```json
{ "pending": 0 }
```

Un número >0 aquí NO es fallo de CP-4 — es evidencia legítima de
que la resiliencia está trabajando. Se registra y sigue.

### CP-5 · Verificación SQL de la fuente de `/players` (session pairing)

Sanity check para el endpoint `GET /players/online`: los jugadores
online deben ser aquellos con `session.start` sin `session.end`
posterior.

```bash
docker exec mc-ecosystem-postgres-1 psql -U mc_events -d mc_events -c \
    "SELECT player_uuid,
            MAX(ts) FILTER (WHERE type='session.start') AS last_start,
            MAX(ts) FILTER (WHERE type='session.end')   AS last_end
     FROM events
     WHERE type IN ('session.start','session.end')
     GROUP BY player_uuid
     HAVING MAX(ts) FILTER (WHERE type='session.start') >
            COALESCE(MAX(ts) FILTER (WHERE type='session.end'),
                     '-infinity'::timestamptz);"
```

Salida esperada: filas con `last_start > last_end` (los online). El
conteo debe coincidir con `length(players)` del CP-4 endpoint.

### CP-6 · Ejecución end-to-end de cada comando en el guild real

Ejecutar en Discord (no automatizable — verificación humana):

- `/players` → embed con la lista ordenada por tiempo de sesión
  descendente, formato temporal `<24h` relativo / `≥24h` absoluto
  en `America/Monterrey`.
- `/tps` → `TPS 1m: X.XX (hace Ys)` o mensaje de stale/N/A según
  freshness 90 s.
- `/status` → las 9 líneas con datos coherentes con CP-4 y CP-5.

Cada respuesta debe mostrar el badge **"Sólo tú puedes ver esto"**
en el cliente Discord del ejecutante y NO aparecer en el canal para
otros miembros (verificación D5 · ephemeral).

Evidencia: screenshot de los 3 embeds ephemeral con timestamps y
mismo estado observable que CP-4/CP-5, adjunto al commit o al PR de
cierre de B.1.

### CP-7 · CI verde con el conteo de tests aumentado

```bash
gh run list --branch main --limit 1
```

Salida esperada:

```
completed	success	<mensaje del commit de B.1>	CI	main	push	<run-id>	<duración>
```

Además, el job "Bot Pulso" debe registrar un conteo de tests
estrictamente mayor al del commit anterior a B.1 (`212d68f` cerró
con 1123/1123; el commit de B.1 debe cerrar con >1123 verdes por
los nuevos casos de los 3 handlers + tests de builder).

```bash
gh run view <run-id> --job <bot-pulso-job-id> --log | \
    grep -E "Tests\s+[0-9]+ passed"
```

Salida esperada: número >1123, sin filas rojas.

## Consecuencias

**Positivas · operacionales (observables end-user o en métricas).**

- El bot deja de ser 100% reactivo. Con 3 comandos cerramos las
  consultas más frecuentes del día a día ("¿está up? ¿quién juega?
  ¿va lento?") sin abrir Discord al canal principal para
  buscarlas. Medible: uso de los 3 comandos en logs post-deploy.
- `/status` con DLQ pendientes hace visible por default la métrica
  operativa clave del ADR-013. Un problema silencioso en el
  pipeline deja de esperar a que alguien mire logs. Medible:
  primera vez que el número >0 en `/status` dispara una acción
  humana sin que hiciera falta abrir Grafana o `docker logs`.
- El endpoint `GET /players/online` es reusable por Genesis
  (v2.0 Insight, FASE D) — el trabajo de B.1 no se desperdicia al
  llegar la fase siguiente. Verificable: Genesis lo consume desde
  su primer sprint de dashboard "quién está ahora".

**Positivas · institucionales (documentación normativa, precedentes
firmados). Menos "observables end-user", más "reducen re-litigación
en decisiones futuras".**

- La regla anti-flakiness queda promovida de "lección del cierre
  de FASE A" a estándar de código del bot con documento
  normativo (este ADR, sección D6). Cualquier PR futuro puede
  citarla en vez de re-debatir el patrón `it.each + Math.random`.
- El script `register-commands` establece el patrón operativo
  auditable para futuros comandos: cambio en git → ejecución
  explícita → evidencia en logs. No hay "quién registró qué y
  cuándo" implícito.
- Consistencia con least-privilege del ecosistema (D4): la línea
  "lectura = abierto, mutación = admin" queda firmada para no
  re-litigarla en cada comando futuro. Se paga al escribir el
  primer comando administrativo — no habrá discusión de fondo.

**Negativas · costes asumidos con mitigación real, no cosmética.**

- **TTL de cache 10 s en `/players`** puede mostrar información
  con hasta 10 s de retraso frente al pipeline. **NO se mitiga —
  se acepta como trade-off consciente**: la alternativa (TTL 0)
  eleva load del api sin beneficio observable a la ganancia de
  dedup entre usuarios cercanos. Documentado explícitamente
  aquí para que un lector futuro no lo lea como bug.
- **El script manual `register-commands` requiere disciplina de
  ejecución.** Si alguien cambia un comando y olvida correrlo, el
  cambio no propaga a Discord. **Mitigación concreta**: (a) la
  sección "Registro de slash commands" del runbook (matiz D2)
  lista el comando y su output esperado; (b) el ADR de la fase
  que introduzca cambios de contrato (B.2+) debe listar
  `npm run register-commands` como paso de cierre igual que
  `npm test` y `git push`; (c) CP-2 de "Verificación de runtime"
  detecta la desviación en el cierre de fase (los IDs de Discord
  no coinciden con los declarados).
- **`/status` con 9 líneas es más denso que el diseño inicial de
  4** — riesgo residual de embed sobrecargado. **Mitigación
  concreta**: el embed usa `EmbedBuilder.addFields([...])` con
  `inline: true` para dos columnas escaneables; si en producción
  se detecta densidad excesiva, la lista de líneas es una
  decisión operativa del handler que puede podarse sin cambiar
  este ADR (la parte estructural es "9 líneas, no 4 ni 20", no
  "estas 9 exactas para siempre").
- **Ephemeral bloquea auto-refresh y paginación futuros.** No hay
  mitigación técnica — es un límite del canal de comunicación
  elegido. **Compensación firmada** en la sección "Fuera de
  alcance B.1" y en D5: cuando aparezca el requerimiento, se
  abrirá un comando distinto NO ephemeral con su propio ADR;
  el comando existente NO se convierte a público a mitad de
  vida.

Coste omitido deliberadamente: "el nuevo endpoint `GET /players/online`
añade una ruta al api". Es marginal — el api ya tiene el patrón
en `api/src/routes/players.ts` — y mencionarlo aquí sería relleno
cosmético. Los 4 costes de arriba son los honestos.

## Alternativas descartadas

- **`@discordjs/core` en vez de `discord.js`** — pierde
  `SlashCommandBuilder` y helpers de embeds; el ahorro de bytes
  no compensa para 3 comandos.
- **Auto-registro al arrancar el bot (D2 opción a)** — riesgo real
  de rate-limits, sin trazabilidad de "quién publicó qué comando
  cuándo", y ganancia nula frente al script manual (los comandos
  cambian pocas veces).
- **RCON directo desde el bot (D3, `/tps` opción b)** — obliga a
  duplicar `RCON_PASSWORD` en un contenedor más, bloquea el
  server con cada consulta, y desperdicia la telemetría ya
  pre-calculada por el plugin en la tabla `events`.
- **`GET /players/online` reemplazado por query directa al event
  store desde el bot** — rompería la disciplina "bot → api, nunca
  bot → DB" (ADR-009). El endpoint marginal es barato; la
  regresión arquitectónica no lo es.
- **Permisos restrictivos por rol o admin-only (D4)** — introduce
  fricción social sin cerrar ningún vector real de daño; los 3
  comandos son read-only. El precedente correcto (lectura =
  abierto, mutación = admin) es más útil que restringir a lo
  restringido.
- **Respuestas públicas al canal (D5)** — desalinea slash commands
  con narrativa; ensucia el canal con duplicados; convierte una
  consulta en un anuncio no deseado.
- **Biblioteca de mocking de Discord (D6, ej. `discord.js-mock`)** —
  dependencia externa sin mantenimiento activo por 3 comandos; el
  mock manual con `vi.fn()` es directo y consistente con el resto
  del código del bot.
- **Reservar el número ADR-015 para B.1 y renumerar D.1 (D7)** —
  ADR-014 ya reservó explícitamente 015 para D.1; renumerar
  crearía justo el problema de colisión que este ADR y ADR-014
  intentan evitar institucionalizadamente.
- **`/status` limitado a 4 líneas** (propuesta inicial) — deja
  fuera DLQ pendientes, cursor lag, y últimas alertas; obligaría
  a comandos ulteriores (`/dlq-status`, `/bot-info`) que rompen
  la disciplina "3 comandos, nada más" de B.1. La expansión a 9
  líneas consolida "salud del ecosistema" sin ampliar el catálogo
  de comandos.

## Fuera de alcance B.1

Lista explícita de features que **no** entran en B.1 y quedan
diferidas a fases posteriores (B.2, D, o ADRs propios cuando
lleguen). Documentar los "no" evita que la implementación se
expanda por inercia y clarifica el contrato con quien lea este
ADR después.

### Comandos NO incluidos

- **`/stats`** — estadísticas agregadas por jugador o server-wide
  (kills, deaths, tiempo total jugado, etc.). Requiere queries
  no triviales sobre `events` y decisiones de agregación
  (ventanas, top-N, empates). Candidato natural para v2.1 Memoria
  del roadmap (ver `docs/roadmap-consolidacion-v1.2-v2.0.md:39`).
- **`/rank`** / **`/leaderboard`** — rankings competitivos entre
  jugadores. Depende de v3.0 Legacy (motor de títulos, Rey Minero,
  destronamientos — línea 40 del roadmap). No se puede armar
  consistente sin ese motor definido primero.
- **`/history`** — línea de tiempo de eventos de un jugador o del
  server. Requiere paginación (fuera por D5) y decisiones de
  filtro que multiplican el alcance. Candidato para v2.1 o para
  un endpoint de Genesis (v2.0 Insight, FASE D).
- **`/backup-status`** — estado del último backup exitoso. La
  información vive en el contenedor `mc-ecosystem-backup-1` (no
  en `events`); integrarla obligaría a leer restic snapshot list
  o emitir un evento `backup.completed`. Ampliación explícita
  fuera de la línea 5 de `/status` (ya documentado en D3).
- **Comandos administrativos** (`/prune-events`, `/replay-dlq`,
  `/give`, `/gamemode`, `/op`, `/whitelist add`, etc.) — mutan
  estado del server o del pipeline. Precedente D4 los reserva
  para `default_member_permissions: Administrator`, pero **no
  entran a B.1**. Cada uno tendrá su propio ADR o su propia
  decisión explícita cuando llegue.
- **Bridge de chat** (Discord ↔ Minecraft) — requiere activar el
  intent `MESSAGE CONTENT` (privilegiado, requiere aprobación
  del Portal a partir de 100 guilds) y toca dos direcciones
  distintas de I/O. Alcance grande, ADR propio en su momento.

### Capacidades NO soportadas por los 3 comandos de B.1

- **Auto-refresh del contenido** — los embeds son snapshots del
  momento de ejecución. Ephemeral no permite actualización desde
  otro contexto (D5). Si aparece la necesidad, será un comando
  distinto NO ephemeral con su propio ADR.
- **Paginación** — los 3 comandos caben en un embed corto. No hay
  flujo multi-página, ni botones "Next/Prev", ni reacciones para
  navegar (D5). Un futuro `/history` con paginación entra por su
  propio comando y su propio ADR.
- **Persistencia post-cierre de Discord** — ephemeral desaparece
  del cliente al reiniciar. Nadie debe apoyarse en "abro el
  `/status` de ayer" (D5). La solución correcta es re-ejecutar.
- **Publicar respuestas al canal** — todos ephemeral por default
  (D5). Si en v1.2 (o después) aparece la necesidad de compartir,
  se hará mediante un **flag explícito** por comando —
  provisionalmente nombrado `--publico:true` o
  `share:true` — que crea una segunda variante NO ephemeral del
  comando con su propia decisión. **No se convertirá el comando
  existente en público a mitad de vida.**
- **Parámetros de entrada** — los 3 comandos son sin opciones (no
  aceptan argumentos). `/players` no acepta filtro por nombre,
  `/tps` no acepta ventana temporal, `/status` no acepta selector
  de sección. Cada parámetro futuro es un cambio de contrato que
  entra por su propio release con nota de cambio.
- **Notificaciones push desde el bot al usuario** — el bot ya
  publica narrativa al canal principal; los slash commands son
  pull, no push. Cualquier mención directa (`<@user>`) o mensaje
  privado (DM) queda fuera de B.1.

### Fuentes de datos NO usadas por B.1

- **RCON directo al server Minecraft** — descartado en D3 · `/tps`
  y reforzado aquí. El bot no debe conocer `RCON_PASSWORD`.
- **Consultas directas a Postgres desde el bot** — descartado en
  D3 · `/players`. Todo pasa por endpoints del api (ADR-009).
- **Lectura de logs del server** — para uptime, jugadores online,
  etc. La fuente de verdad es la tabla `events`. Logs son ruido
  transitorio, no estado consultable.
- **Backblaze B2 desde el bot** — para verificar backups. Fuera
  de alcance (ver `/backup-status` arriba).

Cualquier feature de las listas anteriores que aparezca en un PR
etiquetado como "B.1" debe rebotarse: o se difiere, o se abre su
propio ADR y su propia fase.

## Referencias cruzadas

- **ADR-009 · api HTTP como superficie única** — el bot consulta
  al api, no a la DB. Aplica a los 3 endpoints usados por B.1
  (`GET /players/online` nuevo, `GET /events?…` existente para
  TPS, `GET /admin/dlq/pending-count` existente para DLQ).
- **ADR-011 · runtime siempre coincide con código** — la
  verificación de runtime de la sección superior aplica el
  principio general a la verificación de cierre de B.1.
- **ADR-013 · resiliencia del bot** — el número de DLQ pendientes
  en `/status` es la evidencia observable por default de que el
  sistema resiliente creado en A.3 está funcionando (o merece
  intervención cuando el número crece).
- **ADR-014 · checklist de nacimiento institucional**:
  - **CP-A** (todos los `.jar` propios en el volumen): no aplica
    directo a B.1 (no se tocan `.jar`), pero el patrón general
    "verificar que el runtime tiene lo que el código declara" es
    la raíz de la verificación de registro efectivo en Discord.
  - **CP-B** (dueño con OP): el precedente "lectura abierta,
    mutación admin" de D4 es la extensión discord-lado de la
    misma lógica que gobierna OPs del mundo Minecraft.
  - **CP-C** (secretos de `.env` presentes con formato correcto):
    la fail-fast del script `register-commands` (matiz D2)
    aplica el mismo principio — validar `DISCORD_BOT_TOKEN`,
    `DISCORD_CLIENT_ID` y `DISCORD_GUILD_ID` antes de tocar la
    superficie externa, con `grep -c` o equivalente al leerlos,
    nunca exponiendo valores en logs. Nota: cada aplicación del
    monorepo tiene su propio `.env` (bot en `bot/.env`, infra
    compartida en `infra/.env`); ADR-014 CP-C aplica por servicio,
    no a un archivo único centralizado.
  - **CP-D** (verificación de runtime tras cualquier fase que
    toque volúmenes/plugins/env): B.1 modifica la imagen del
    bot; el punto 2 de "Verificación de runtime" arriba
    (ejecución end-to-end en el guild real) es exactamente el
    checkpoint CP-D aplicado a esta fase.
- **`docs/roadmap-consolidacion-v1.2-v2.0.md`**:
  - Línea 14: B.1 es la tarea P2-1 del roadmap.
  - Línea 16: al cerrar B.1, el bot "deja de ser 100% reactivo".
    Este ADR captura la definición operativa de esa transición.
  - Línea 26: ADR-015 reservado para D.1 → confirma que 016 es
    el número correcto (D7).
- **`docs/runbook.md` · Fix post-FASE A · flakiness institucional
  en tests de catálogos** — la regla anti-flakiness citada en D6
  se documenta ahí como descubrimiento y aquí como estándar
  vinculante del bot.
- **`bot/src/handlers/tps-handler.ts:15-19`** — la disciplina de
  "TPS antiguo es mentir" se reusa en D3 · `/tps` y en la línea
  4 de `/status`. Un solo criterio de freshness (90 s) aplicado
  consistentemente.
- **Memoria persistente del asistente**: la regla anti-flakiness
  guardada tras el commit `212d68f` queda ligada a este ADR como
  su documento normativo — cualquier sesión futura que edite
  tests del bot debe citarlo o justificar la desviación.
