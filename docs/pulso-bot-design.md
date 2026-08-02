# Diseño: Bot de Discord (v1.1 Pulso — Sesión 2)

- **Estado**: borrador para aprobación humana. Ningún cambio de código
  ni infra. Ninguna decisión firmada hasta revisión.
- **Fecha**: 2026-07-26
- **Alcance**: exclusivamente diseño arquitectónico. Cierre de decisiones,
  no implementación.

## Objetivo v1.1 "Pulso"

El bot es el **pulso público** del servidor: hace visible lo que está
pasando (quién está online, qué se acaba de conseguir, qué evento
arrancó) para los amigos que aún no están en el juego. Nace como
proyección "read-only" de la telemetría que ya emite EventCollector
(ver `docs/event-catalog.md` y ADR-007).

**Fuera de alcance en v1.1** — se mencionan sólo para acotar:
- Chat bidireccional Discord ↔ Minecraft (v1.2+; requiere cambios en el
  plugin, aprobación de consentimiento, decisión sobre webhooks).
- Comandos administrativos (`/whitelist`, `/kick`) — v1.2 al menos.
- Persistencia propia del bot (rankings, tarjetas de jugador) — Insight,
  no Pulso.

## Contexto de infra reutilizable

Lo que el bot puede consumir **sin crear infraestructura nueva**:

- **Postgres** (servicio `postgres` del compose) — tabla `events` con
  todo lo capturado desde el cutoff oficial `2026-07-26 23:25:52 UTC`
  (ADR-007). Read-only para el bot; escritura sigue siendo exclusiva de
  la API.
- **API HTTP interna** (`api` en Fastify, endpoint actual: `POST /events`).
  Es de ingesta; **no expone endpoints de lectura hoy**. Añadirlos es
  una opción viable (queda como decisión debajo).
- **Docker Compose** — patrón consolidado: nuevo servicio en `dev.yml`
  (compartido) + entrada en `prod.yml`/`staging.yml` según corresponda.
- **`bot/` directorio** ya existe vacío desde 2026-07-15 — placeholder
  listo para el código.

---

## Decisión 1 — Stack tecnológico del bot

**Problema**: elegir lenguaje + librería Discord + toolchain para el
servicio bot.

**Opciones evaluadas**:

| Opción | Ventajas | Desventajas |
|---|---|---|
| **A. Node.js 22+ + TypeScript + discord.js v14** | Consistencia con `api` (mismo runtime, mismo TS, mismo `packages/shared`). Discord.js es la lib de referencia (~90% del ecosistema); docs abundantes; tipos oficiales sólidos. `packages/shared` puede alojar tipos comunes plugin↔api↔bot. | Discord.js es "opinionada" (event-emitter clásico + cache pesada). Consumo de memoria mayor que alternativas minimalistas. |
| **B. Node.js + TypeScript + Eris** | Más ligero que discord.js (~½ de RAM); API más cercana a la REST de Discord. Sigue en TS/Node. | Comunidad más pequeña; menos plugins/ayuda; tipos menos maduros. |
| **C. Python + discord.py / py-cord** | Sintaxis muy limpia para bots; librería veterana. | Rompe la homogeneidad TS del monorepo; segundo runtime a mantener; `packages/shared` deja de aplicar. |
| **D. Rust + serenity** | Bajísimo consumo; robustez de compilación. | Curva de desarrollo alta para un bot conversacional que va a evolucionar rápido; no hay resto del stack en Rust; añadir un tercer lenguaje al monorepo. |

**Recomendación**: **A (Node.js + TypeScript + discord.js v14)**.

**Justificación técnica**:
- Homogeneidad con `api` reduce toolchain a mantener (un solo `tsc`,
  un solo `node`, un solo `package.json` pattern).
- `packages/shared` puede exportar tipos TS derivados del catálogo de
  eventos (interfaces `SessionStartEvent`, `BlockBreakEvent`, etc.) que
  api y bot consumen sin duplicar schema.
- discord.js v14 es el punto Schelling: cualquier tutorial, Stack
  Overflow o issue de Discord Developer va a asumir discord.js. Para
  un servicio de baja criticidad, la fricción de una lib exótica no
  compensa.
- Consumo de RAM de discord.js con 1 guild pequeño (~10 miembros) es
  <100 MB — irrelevante en la máquina que ya corre Paper con 4 GB.

---

## Decisión 2 — Arquitectura de comunicación con el ecosistema

**Problema**: cómo consulta el bot los datos y eventos que necesita
mostrar (estado del servidor, jugadores online, últimos eventos).

**Opciones evaluadas**:

| Opción | Ventajas | Desventajas |
|---|---|---|
| **A. Bot lee directamente Postgres (rol read-only)** | Latencia mínima; sin capa HTTP intermedia; el bot es un consumidor de datos, encaja con read-only. Fácil de agregar (nueva role `mc_bot` con `SELECT` sobre `events` y `players`). | Acopla el bot al schema físico de la DB: cambios en columnas requieren coordinar; pierde el contrato "todo pasa por la API" que ya sigue el plugin. |
| **B. Bot llama al `api` HTTP (endpoints nuevos de lectura)** | Contrato explícito HTTP; cambios de schema aislados detrás del handler; permite añadir cache o rate limiting en la API sin tocar el bot. Sigue la disciplina que ya existe (plugin escribe por HTTP, api es la única que toca la DB con `mc_app`). | Requiere implementar endpoints de lectura en `api` (hoy sólo hay `POST /events`). No es esfuerzo grande pero es trabajo nuevo. |
| **C. Híbrido: bot lee DB para queries analíticas, api HTTP para acciones/salud** | Aprovecha lo mejor de A y B según caso de uso. | Dos superficies de acoplamiento a documentar y mantener; violaciones de disciplina difíciles de detectar. |

**Recomendación**: **B (Bot → api HTTP, con endpoints diseñados como
Event Store consumibles por cualquier cliente, no específicos del bot)**.

**Justificación técnica**:
- Preserva la invariante *"solo `api` toca la DB con `mc_app`"* que
  hemos protegido desde el ADR-001. Un segundo cliente contra Postgres
  fragmenta la lógica de acceso.
- Los endpoints nuevos son **agnósticos del consumidor**: los mismos
  contratos sirven al bot Pulso, a Insight (analítica), a Genesis
  (crónicas) y a cualquier consumidor futuro. Diseño propuesto:

  | Endpoint | Propósito | Contrato |
  |---|---|---|
  | `GET /health` (ya existe) | Liveness de la api. | Bool 200/500 |
  | `GET /events` | **Event Store genérico**. Ver Decisión 3 para cursor. | Query params: `after_id` (BIGINT, cursor), `limit` (int, default 100, max ~500), `types` (CSV opcional de tipos del catálogo), `until_id` (BIGINT opcional, upper bound). Respuesta: array de eventos ordenados por `id` ASC, más el `last_id` del batch para próxima query. |
  | `GET /players/online` | Derivada: jugadores con `session.start` sin su `session.end`. | Array `[{player_uuid, name, session_start_ts}]`. Cualquier consumer puede recalcular a mano desde `/events`, pero se ofrece precocinado por conveniencia. |
  | `GET /stats/uptime` | Derivada: tiempo desde el último `server.start`. | `{last_start_ts, uptime_s}`. |

  Regla de diseño: **`GET /events` es el contrato primario**. Los
  endpoints derivados (`/players/online`, `/stats/uptime`) son
  conveniencia optimizada — se pueden reconstruir desde `/events`, pero
  se sirven precocinados porque son queries frecuentes con lógica
  simple. Si un consumer tiene lógica agregada compleja (rankings,
  crónicas), la construye sobre `/events`, no sobre nuevos endpoints
  ad-hoc en `api`.
- Si la API introduce validación, autorización o caching, todos los
  consumers los heredan gratis. Con la opción A (lectura directa DB),
  cada optimización se replica en cada consumer.
- Costo de latencia local es despreciable (mismo compose network,
  sub-milisegundo).

---

## Decisión 3 — Flujo de obtención de eventos (push vs pull)

**Problema**: el bot necesita **reaccionar** cuando aparece un evento
interesante (jugador entra, logro conseguido, Herobrine aparece,
`event.start`) para postearlo en Discord. ¿Cómo se entera de que hay
un evento nuevo?

**Opciones evaluadas**:

| Opción | Ventajas | Desventajas |
|---|---|---|
| **A. Polling HTTP periódico a `api` con cursor por `id` (`GET /events?after_id=<N>&limit=&types=`)** | Cero infraestructura nueva. Trivial de razonar y de recuperar tras un crash (consumer recuerda `last_processed_id` y pide desde ahí). Escala perfecto a esta carga (~docenas de eventos/hora en gameplay activo). Cursor sobre el `id` sequential de Postgres = determinista y sin dependencia de relojes. | Latencia mínima = intervalo de poll (5-10 s razonable). No es tiempo real. Overhead de queries repetidas incluso cuando no hay eventos. |
| **B. Postgres `LISTEN`/`NOTIFY` desde `api` cuando inserta** | Nativo de Postgres, sin infra nueva. Latencia casi cero (push real). El bot mantiene una conexión persistente que recibe notificaciones. | Añade complejidad en `api` (emitir `NOTIFY` tras cada `INSERT`) y en el bot (gestionar conexión persistente, reconexión, manejo de gaps si la conexión se cayó). `NOTIFY` no persiste — si el bot está desconectado cuando llega el evento, se pierde el aviso (aunque el evento sigue en la DB). Requiere que el bot lea DB directamente (contradice Decisión 2 B). |
| **C. Webhook `api` → bot (HTTP push)** | Latencia baja; el bot expone `POST /events/notify` y el api lo llama tras cada insert. Consistente con "todo pasa por api". | El bot pasa a exponer un puerto (dentro del compose network, no público). Loop de fallo si el bot está down: `api` debe encolar reintentos. Complica `api` con responsabilidad de entrega garantizada. |
| **D. Cola de mensajes (Redis Streams, NATS JetStream, RabbitMQ, Kafka)** — **TECNOLOGÍA NUEVA, no se adopta** | Semántica limpia: `api` publica, el bot suscribe. Buffering nativo (si el bot está caído, los mensajes esperan). Escalable a múltiples consumidores (Insight, otros bots). | **Introduce un servicio nuevo al stack** que hoy no existe. Añade tres cosas a mantener: la propia cola, la disciplina de tópicos/streams, y la operación (backups, monitoreo, versiones). Sobredimensionado para 1 productor + 1 consumidor con carga de ~10 eventos/min. |

**Recomendación**: **A (polling HTTP cada 5-10 s con cursor por `id`)**.

**Cursor concreto**: el `id` de la tabla `events` (`BIGINT GENERATED
ALWAYS AS IDENTITY PRIMARY KEY`, ya definido en el schema del catálogo
v1). El consumer mantiene un `last_processed_id` propio y consulta
`GET /events?after_id=<N>&limit=100&types=session.start,session.end,advancement.done,event.start,event.end,haunt.appearance`
(los `types` que le interesen). El servidor responde con eventos de
`id > N` ordenados ascendentemente por `id` y limitados a `limit`.

**Por qué cursor por `id` y no por `ts` (timestamp)**:

- **Sin problemas de reloj**. El `ts` de un evento lo pone el plugin
  con `Instant.now()` del reloj del contenedor Paper; `received_at` lo
  pone Postgres al insertar; el consumer compara contra un valor
  guardado localmente con reloj propio. Cualquier deriva entre esos
  tres relojes (típico en Docker, WSL, VMs) produce que un `since=<ts>`
  se salte eventos o los repita. `id` es asignado por Postgres al
  insertar — un solo reloj (el del secuence), monotónico por definición.
- **Consumo determinista**. Dado `after_id=N`, la API devuelve **siempre
  el mismo conjunto** de eventos: los que tienen `id > N`, en orden
  estricto. Append-only garantiza que no cambia lo ya insertado; el
  consumer procesa cada evento exactamente una vez (o dedupe por
  `event_uuid` si su lógica no es idempotente).
- **Sin bordes ambiguos**. Con `ts`, dos eventos con timestamp
  idéntico (raro pero posible bajo alta concurrencia o en la misma
  llamada de listener) requieren decidir entre `>` y `>=`, y cualquiera
  de los dos duplica o pierde. `id` es único y estricto: `id > N` no
  tiene esta patología.
- **`event_uuid` sigue siendo la clave de idempotencia**, no el cursor.
  UUID v4 es aleatorio, sin orden natural — perfecto para detectar
  reintentos, inservible como cursor. Se complementan: `id` ordena,
  `event_uuid` deduplica.

**Justificación técnica del polling (vs alternativas B/C/D)**:

- Carga esperada es baja (mundo de 1-3 amigos). Un poll cada 5 s a la
  api local pide, en el peor caso, ~200 KB/día de tráfico HTTP interno.
- Simplicidad operativa: si el bot muere y arranca 20 min después,
  pide `after_id=<último_id_procesado>` y se pone al día. Cero mensajes
  perdidos por diseño (la fuente de verdad es la DB append-only).
- **Preserva la invariante de Decisión 2** (solo api toca la DB).
- La opción B (LISTEN/NOTIFY) es tentadora pero rompe Decisión 2 y no
  ofrece ventaja perceptible para el caso de uso: los amigos no notarán
  5 s de diferencia entre un logro y el post en Discord.
- La opción D (cola nueva) se descarta por sobreingeniería. **Se
  presenta explícitamente como opción para revisión**: si el dueño
  decide priorizar tiempo real duro o si el fan-out a múltiples
  consumidores (Insight, Genesis) supera lo que polling coordina bien,
  revisitar entonces.

**Trade-off aceptado**: latencia de 5-10 s entre evento y post. En
observaciones internas puede ser 1-2 s si se implementa long-polling
(el consumer deja la conexión abierta hasta 30 s esperando eventos
nuevos con `after_id > N`; la api responde cuando hay, o al timeout).
No lo prescribimos aquí — decisión al implementar.

---

## Decisión 4 — Funcionalidades v1.1

**Problema**: qué features entran en la primera versión pública del
bot y qué se defiere.

**Opciones evaluadas** (priorización tipo MoSCoW):

### Must (v1.1 arranca con esto)

| Feature | Descripción | Fuente de datos |
|---|---|---|
| **Notificación de join/leave** | Post en canal principal cuando un jugador entra o sale. Formato: *"Vancorbus se conectó (X online)"*. | `session.start` + `session.end` |
| **Notificación de logros** | Post cuando cualquier jugador consigue un advancement de Minecraft. Formato: *"Elrid consiguió: **Enter the Nether**"*. | `advancement.done` |
| **Notificación de eventos** | Post cuando arranca/termina un Modo Evento o aparición de Herobrine. Formato: *"⚡ Torneo del Ki iniciado (5 min)"* / *"👻 Vancorbus vio algo raro..."* (para `haunt.appearance` con `seen=true`). | `event.start`/`event.end`, `haunt.appearance` |
| **`/status`** slash command | Devuelve online/offline del servidor, jugadores conectados, TPS del último minuto. | `GET /health`, `server.tps_sample` último |
| **`/online`** slash command | Lista jugadores conectados con tiempo de sesión. | `session.start` sin `session.end` |
| **`/uptime`** slash command | Tiempo desde el último `server.start`. | Query directa a `events` (via api) |

### Should (v1.1 si sale ligero, si no v1.1.x)

| Feature | Descripción | Notas |
|---|---|---|
| **Notificación de muertes graciosas** | Post con el `player.death.data.message` de vanilla ("Vancorbus was blown up by Creeper"). | Riesgo: puede ser ruidoso. Toggle por canal. |
| **`/recent`** slash command | Últimos N eventos de un tipo dado (útil debug). | Requiere endpoint `GET /events/recent`. |

### Could (backlog v1.2+)

- Chat bridge Discord ↔ Minecraft (requiere cambios plugin + decisión de privacidad).
- Comandos admin (`/whitelist add`, `/restart`).
- Embed rico con thumbnail del jugador (requiere endpoint de skins).

### Won't (v1.1 no lo hará)

- Rankings o "player of the week" — es territorio de Insight, no Pulso.
- Voice channels dinámicos ("Currently playing: 3").
- Integración con streaming (Twitch/YouTube).

**Recomendación**: entregar los **6 Must** en v1.1.0. Los Should en
v1.1.1 si el ritmo lo permite.

**Justificación técnica**:
- Los 6 Must son lecturas simples y notificaciones basadas en poll →
  encajan directamente con Decisión 3 A sin backend nuevo.
- Muertes son un caso de UX: gracioso las primeras veces, ruidoso en
  sesiones largas. Dejar toggleable evita el rechazo temprano.
- Chat bridge se defiere porque exige tocar el plugin (nuevo listener
  de chat que ya emite a events, más webhook al bot O al revés) —
  scope propio.

---

## Decisión 5 — Configuración en Discord Developer Portal

**Problema**: qué hay que crear en Discord (fuera del código) antes de
que el bot pueda funcionar.

**Recomendación** (una sola configuración razonable, sin alternativas
significativas):

1. **Application** en <https://discord.com/developers/applications> con
   nombre `mc-ecosystem-pulso` (o el que el dueño prefiera).
2. **Bot user** dentro de la application:
   - `Public Bot`: **OFF** (evita que terceros lo agreguen a sus
     servidores).
   - `Requires OAuth2 Code Grant`: **OFF** (bot puro, no flujo web).
3. **Intents** (Gateway → Privileged Gateway Intents):
   - `MESSAGE CONTENT INTENT`: **OFF** por ahora — v1.1 no lee mensajes
     de usuarios. Cuando llegue chat bridge (v1.2), tocará activarlo y
     Discord pedirá justificación si el bot supera 100 servidores (no
     aplica a nosotros).
   - `SERVER MEMBERS INTENT`: **OFF** — no necesitamos listar miembros.
   - `PRESENCE INTENT`: **OFF** — no necesitamos ver estado de Discord
     de nadie.
4. **OAuth2 scopes** para el link de invitación:
   - `bot`
   - `applications.commands` (para slash commands)
5. **Bot permissions** en el invite:
   - `Send Messages`
   - `Embed Links`
   - `Read Message History` (para editar/borrar sus propios posts si
     necesitamos)
   - `Use Slash Commands`
6. **Token del bot**: se genera desde el portal (`Reset Token`) — es
   un secreto de máxima sensibilidad, va a `.env` como
   `DISCORD_BOT_TOKEN` (ver Decisión 7) y se guarda en Bitwarden
   inmediatamente. Aplican las reglas anti-quemar-keys del runbook: **el
   asistente no lo lee**.
7. **Guild (servidor Discord)**: el bot se invita al servidor del dueño
   con el link generado en el paso 4. Se apunta el `guild_id` en
   `.env` como `DISCORD_GUILD_ID` (no es secreto, pero se versiona por
   entorno).
8. **Canales**: al menos uno de "eventos" (donde se postean joins,
   logros, etc.). ID en `.env` como `DISCORD_EVENTS_CHANNEL_ID`.

**Justificación técnica**: intents mínimos (sólo el default de gateway,
sin privileged). Cuanto menos permiso pida el bot, menos superficie de
riesgo y menos aprobaciones futuras de Discord.

---

## Decisión 6 — Estrategia de despliegue (Docker Compose)

**Problema**: cómo se orquesta el bot junto a los servicios existentes.

**Opciones evaluadas**:

| Opción | Ventajas | Desventajas |
|---|---|---|
| **A. Servicio nuevo `bot` en `dev.yml`** | Coherente con `api`, `backup`, `postgres`. Bot depende de `api` (que depende de `postgres`), todo con `depends_on` y healthchecks. Un solo `start-mc.bat` sigue orquestando todo. | Añade una unidad más al stack — pero es una más de un patrón que ya se paga. |
| **B. Servicio en `dev.yml` + toggle por env** | Igual que A pero con `DEPLOY_BOT=false` para saltarlo en entornos donde no interese. | Complejidad extra que no pide caso de uso real hoy. |
| **C. Bot fuera del compose (proceso systemd / script)** | Bot puede correr aunque Docker esté abajo. | Rompe la homogeneidad del proyecto; añade "otro sitio dónde arrancar el bot"; complica logs (`docker logs` vs journal). |

**Recomendación**: **A (servicio nuevo `bot` en `dev.yml`)**, con
entradas específicas por entorno en `staging.yml` y `prod.yml` si
divergen (probablemente sí: canal diferente, log level, etc.).

**Justificación técnica**:
- El bot no es más crítico que el propio Minecraft; si Docker está
  abajo, no hay servidor que reportar. La opción C no aporta.
- Config del servicio (esqueleto de referencia, **no** implementación
  final):
  ```
  bot:
    build: ../bot
    environment:
      DATABASE_URL_UNUSED: "no leemos DB directamente; ver Decisión 2"
      API_URL: "http://api:3000"
      DISCORD_BOT_TOKEN: "${DISCORD_BOT_TOKEN}"
      DISCORD_GUILD_ID: "${DISCORD_GUILD_ID}"
      DISCORD_EVENTS_CHANNEL_ID: "${DISCORD_EVENTS_CHANNEL_ID}"
    depends_on:
      api:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:4000/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 5
    restart: unless-stopped
  ```
- `start-mc.bat` ya bringa `api backup playit` como servicios base; se
  añade `bot` al mismo grupo. El health-check loop existente (ver
  commit `a8c6a1d`) verifica el bot como cualquier otro servicio.

**Nota sobre health vs readiness**: el healthcheck de arriba usa un
único endpoint `/health` que representa *"proceso vivo, event loop
responsivo"* — es el equivalente de un **liveness probe**. En v1.1
esto basta y comparte implementación con la readiness (si el proceso
responde, asumimos que también está listo).

En el futuro convendrá **diferenciar** los dos conceptos:

- **Health / liveness** (`GET /health`): el proceso está vivo. Docker
  Compose y Kubernetes-like orchestrators usan esto para reiniciar
  el contenedor si falla.
- **Readiness** (`GET /ready`): el bot está **listo para servir** — está
  conectado al Gateway de Discord, `api` es alcanzable, ha hecho el
  primer poll con éxito. Un bot "healthy pero no ready" está arriba
  pero no debería recibir tráfico ni contarse como operacional.

La distinción importa cuando el ciclo de arranque es largo (Discord
Gateway handshake puede tardar segundos, `api` puede estar aún
`starting`) o cuando queremos evitar posts a Discord antes de que el
consumer esté sincronizado. Es una mejora **no bloqueante para v1.1** —
implementarla es un cambio pequeño (nuevo handler + entrada aparte en
el compose healthcheck) que se difiere hasta que aparezca un caso de
uso concreto (falsos "listo" en el health-check loop del `.bat`, o
posts duplicados al reconectar).

---

## Decisión 7 — Configuración y secretos

**Problema**: qué variables de entorno introduce el bot y cómo se
gestionan.

**Opciones evaluadas** (aquí prácticamente sin alternativas —
seguimos el patrón del proyecto):

- **`.env` en `infra/.env`** (gitignored), con las claves:
  - `DISCORD_BOT_TOKEN` (secreto, máximo cuidado)
  - `DISCORD_GUILD_ID` (no-secreto pero por-entorno)
  - `DISCORD_EVENTS_CHANNEL_ID` (idem)
  - Opcional: `DISCORD_DEATHS_CHANNEL_ID` si separamos muertes de eventos
  - Opcional: `BOT_POLL_INTERVAL_SECONDS` (default 5) para tunear
    Decisión 3.

**Reglas heredadas (runbook)**:
- El token va también al gestor de contraseñas (Bitwarden) tras crearlo.
- Aplica la regla anti-quemar-keys: el asistente **no lee `.env`**
  para verificar; si necesita saber si una variable existe, `grep -c
  '^DISCORD_BOT_TOKEN=' infra/.env`.
- Rotación del token: si alguna vez se filtra en logs o chat, `Reset
  Token` en Discord Developer Portal, actualizar `.env`, restart del
  servicio bot. Registrar la rotación en la tabla histórica del
  runbook (misma tabla donde vive `restic-prod-2`/`restic-prod-3`).

**Justificación técnica**: consistencia estricta con el resto del
proyecto. Cero desviación.

---

## Decisión 8 — Estrategia de pruebas

**Problema**: cómo validar que el bot funciona sin depender de un
servidor Discord "real" en cada iteración.

**Opciones evaluadas**:

| Opción | Ventajas | Desventajas |
|---|---|---|
| **A. Vitest (unit) + un "test guild" Discord dedicado** | Unit tests rápidos con mocks; test guild es un servidor Discord pequeño donde el bot puede ser invitado y verificar en vivo sin ruido. | Requiere crear + mantener el test guild. |
| **B. Sólo unit tests con mocks estrictos de discord.js** | Cero infra externa. | Bugs de integración con Discord API se descubren sólo en prod. |
| **C. Framework de integración estilo `dfx.dart` u otro simulador** | Reproduce Discord fielmente. | No hay simulador confiable de discord.js abiertamente mantenido. |

**Recomendación**: **A (Vitest unit + test guild)**.

**Justificación técnica**:
- Vitest es la elección natural (ya se usa en `api` con `tsx`, encaja
  con la toolchain TS; sintaxis Jest-compatible que discord.js community
  usa habitualmente).
- Test guild: un servidor Discord privado con un canal, invitas el bot
  de test (application separado de prod, con su propio token), corres
  smoke tests manuales. Costo: ~5 minutos de setup, cero mantenimiento
  después.
- Tests unitarios cubren:
  - Formateo de mensajes (dado `event`, produce embed X).
  - Reducciones de eventos (dedup, filtrado por tipo, agrupación).
  - Registro de slash commands.
- Manuales de smoke en test guild antes de cada release del bot:
  matar servicio, restart, verificar que reconecta; verificar que un
  `session.start` sintético (insertado a mano en DB de staging) genera
  el post.

---

## Decisión 9 — Riesgos conocidos

Listado exhaustivo con mitigación propuesta. Ninguna se implementa en
esta sesión.

| # | Riesgo | Probabilidad | Impacto | Mitigación propuesta |
|---|---|---|---|---|
| 1 | **Filtrado del `DISCORD_BOT_TOKEN`** (log, screenshot, `.env` accidental en repo) | Media | Muy alto (control total del bot; puede leer/enviar mensajes, borrar canales según permisos) | Regla anti-quemar-keys aplicada; `.env` gitignored (ya); rotación inmediata en Discord Portal si ocurre; token con permisos mínimos (Decisión 5). |
| 2 | **Rate limit de Discord API** (429) | Baja con carga esperada; media si algo bugea y postea en loop | Alto (silencia el bot por minutos-horas) | discord.js maneja backoff automático. Añadir sanity check en el bot: máx N posts/min por canal, si se supera, dejar de postear ese tipo y avisar. |
| 3 | **Bot desconectado durante evento importante** (crash, network, restart) | Media | Bajo (poll recupera al reconectar, ver Decisión 3) | Polling with `since=<last_ts>` garantiza cero eventos perdidos siempre que el bot vuelva antes de que el retention pruee eventos. Los backups (`backup.done`, ver runbook) capturan la DB también. |
| 4 | **Discord API cambia intents / requisitos** | Baja (Discord suele avisar meses antes) | Alto (bot deja de funcionar) | Monitorear el changelog oficial mensualmente; suscribirse al blog de Discord Developer; el intent set mínimo (sin privileged) minimiza el riesgo. |
| 5 | **Mensajes ruidosos** (muertes, cambios de dimensión spammy) | Alta | Bajo (irrita, pero no rompe) | Toggle por canal en config; canales separados para "notable" vs "ambient" en v1.1.x. |
| 6 | **Fuga de contenido de chat MC** cuando llegue chat bridge (v1.2+) | N/A (fuera de v1.1) | Alto (privacidad) | Decisión A del catálogo ya cubre consentimiento para MC→DB; para MC→Discord habrá que reconfirmar consentimiento explícito. Documentar cuando llegue. |
| 7 | **`api` cae → bot ciego** | Media | Bajo (bot sigue online pero no postea nada nuevo) | Bot detecta 5xx/timeout consecutivos → posta *"⚠️ Perdí contacto con el servidor"* en el canal y sigue reintentando exponencialmente. |
| 8 | **Discord rate limit en slash command registration** (al hacer deploy commands demasiado rápido en dev) | Media en dev | Bajo | Registrar comandos por guild (no global) para desarrollo — actualización instantánea vs 1h globalmente. |

---

## Decisión 10 — Decisiones que se convierten en ADR si se aprueban

Si el dueño aprueba este diseño, los siguientes puntos ganan estatus de
ADR (con nueva numeración a partir de ADR-008):

- **ADR-008** — *Stack del bot Pulso: Node.js + TypeScript + discord.js
  v14.* Formaliza Decisión 1.
- **ADR-009** — *Comunicación bot ↔ ecosistema vía API HTTP (invariante
  "solo `api` toca la DB").* Formaliza Decisión 2.
- **ADR-010** — *Flujo de eventos por polling HTTP, no push, no cola.*
  Formaliza Decisión 3, incluye trade-off explícito de latencia
  aceptada (5-10s) y compromiso de revisitar si Insight introduce
  fan-out multi-consumer.

Las decisiones 4-8 son operativas / de proceso — se documentan en el
runbook (nueva sección "Servicio bot Pulso") cuando llegue el momento
de implementarlas.

---

## Principios de los consumidores del Event Store

El bot Pulso es el **primer consumidor** del Event Store, no el único.
Insight, Genesis (crónicas), y cualquier consumidor futuro deberán
respetar el mismo contrato de consumo. Estas reglas son transversales
— aplican a Pulso hoy y a los demás cuando lleguen.

1. **Read-only sobre `events`**. Los consumers **jamás** escriben en
   la tabla `events` ni en las tablas satélite (`players`,
   `player_names`). Sólo leen vía `GET /events` (y endpoints derivados
   de `api`). Si un consumer necesita generar eventos nuevos (raro:
   sólo si es también productor, como un plugin), los emite por `POST
   /events` como cualquier otro productor — nunca directo a la DB.

2. **Cursor propio, no compartido**. Cada consumer mantiene su
   `last_processed_id` **de forma independiente**. Ningún consumer
   asume que otro está al día o le pasa su cursor. Esto permite que
   cada consumer avance a su ritmo, se caiga y se recupere solo, y
   se añadan consumers nuevos sin coordinar con los existentes.

3. **Consumo secuencial por `id`**. Los eventos se procesan en orden
   estricto de `id` ascendente. Un consumer que quiera procesar en
   paralelo (workers) debe hacerlo sobre lotes disjuntos garantizando
   orden global — no es el caso de Pulso v1.1, pero sí puede serlo
   de Insight rebuilds.

4. **Idempotencia obligatoria**. Procesar el mismo evento dos veces
   debe producir el mismo estado observable. Fuentes de re-consumo:
   crash y reinicio del consumer, reprocesamientos manuales, replays
   para debugging. Herramienta base: `event_uuid` es único; el consumer
   puede llevar un set/cache de UUIDs recientes para deduplicar si su
   lógica no es naturalmente idempotente.

5. **Retención-aware**. La tabla `events` hoy no expira nada (retención
   infinita a nivel DB; los backups sí tienen retention). Si en el
   futuro se aplica purga (v2+), los consumers deben saber cómo
   recuperarse cuando su `after_id` ya no existe: la respuesta esperada
   de `api` sería HTTP 410 (Gone) o 200 con `oldest_available_id`, y
   el consumer decide su estrategia (saltar al oldest, alertar,
   reconstruir desde snapshot).

6. **Filtro por tipo en la API, no en el cliente**. Los consumers
   pasan `types=X,Y,Z` en la query y reciben sólo eventos relevantes.
   Filtrar en cliente descarga tráfico innecesario y viola el principio
   de mínima transferencia.

7. **Sin acoplamiento entre consumers**. Pulso no sabe que Insight
   existe. Insight no sabe que Pulso existe. Añadir Genesis mañana no
   cambia nada en Pulso ni Insight. Si dos consumers necesitan compartir
   estado, ese estado va en la DB como eventos nuevos, no como
   comunicación directa consumer-a-consumer.

8. **Manejar cursor inicial explícitamente**. Un consumer que arranca
   sin `last_processed_id` guardado debe **decidir su política**:
   - **Skip to latest**: `after_id = SELECT MAX(id) FROM events`
     (Pulso: no anuncia joins/logros del pasado al arrancar limpio).
   - **Full replay from cutoff**: `after_id = 0` con filtro
     `ts >= <ADR-007 cutoff>` (Insight: reconstruye estado desde el
     inicio del mundo real).
   - **Named checkpoint**: `after_id = <id de evento conocido>` (el
     que corresponda a "última vez que corrí un backfill").
   La política es del consumer, no de `api`.

9. **Timeouts y backoff**. Cuando `api` no responde, el consumer NO
   pierde eventos (siguen en la DB); simplemente reintenta con backoff
   exponencial. `GET /events?after_id=<N>` es idempotente por
   definición — reintentar es seguro.

10. **Observabilidad mínima**. Cada consumer expone (por logs o por
    endpoint propio) al menos: su `last_processed_id` actual, timestamp
    del último `GET /events` exitoso, número de eventos procesados en
    la última ventana. Esto permite detectar consumers "atascados" sin
    tener que mirar dentro de cada uno.

Estos principios se citarán desde los ADRs correspondientes cuando
lleguen (Decisión 10). Cambios a estos principios son cambios
arquitectónicos globales — requieren ADR propio.

## Handlers de estado vs handlers históricos

Distinción arquitectónica dentro de los consumidores editoriales
(Pulso, futuros bots narrativos). Fija cuándo aplicar el **contrato
de freshness** (BUG-02A / BUG-02B).

**Handlers HISTÓRICOS** — su publicación describe un hecho pasado
fechado; el mensaje sigue siendo cierto aunque llegue tarde.
Publican en tiempo verbal pasado no comprometido con el ahora
("consiguió", "descubrió", "mató a"). No requieren freshness. La
inmensa mayoría de los handlers son de este tipo: advancement,
death, kill, boss, exploration, dimension, craft, enchant,
technology, villager, milestone, chat, backup.

**Handlers de ESTADO** — su publicación anuncia una transición
como si estuviera ocurriendo ahora. Usan presente o pretérito
perfecto compuesto ("iniciado", "detenido", "se ha unido", "ha
salido", "está lento"). Si un evento antiguo llega por buffer
(`storeDurable` del plugin, retry HTTP tras hiccup), publicarlo
como transición actual sería mentir. **Deben validar frescura
antes de publicar.**

Los handlers de estado actuales son cinco:

| Handler | Evento | Motivo |
|---|---|---|
| `ServerStartedHandler` | `server.start` | Anuncia "servidor arriba ahora" |
| `ServerStoppedHandler` | `server.stop` | Anuncia "servidor caído ahora" (BUG-02 original) |
| `TpsHandler` | `server.tps_sample` | Alerta "servidor lento ahora" |
| `PlayerJoinedHandler` | `session.start` | Afirma "X está conectado ahora" |
| `PlayerLeftHandler` | `session.end` | Afirma "X ya no está ahora" |

**Regla para nuevos handlers**: antes de implementar, responder
tres preguntas — (1) ¿representa historia?, (2) ¿representa estado
actual?, (3) ¿el evento puede llegar tarde por buffer del plugin?
Si (2) y (3) son "sí", es un handler de estado y debe validar
frescura.

**Contrato de freshness**:

- `received_at - ts <= FRESHNESS_THRESHOLD_MS` → publicar.
- `received_at - ts > FRESHNESS_THRESHOLD_MS` → NO publicar,
  emitir WARN estructurado (con `event_uuid`, `id`, `type`,
  `handler`, `ts`, `received_at`, `lag_ms`, `threshold_ms`,
  `motivo`), y devolver normalmente (el cursor avanza; el
  evento sigue en el Event Store como fuente de verdad).
- Timestamps mal formados → fail-open (tratar como fresco). La
  validación de schema vive en el `EventStoreClient`; el helper
  no re-litiga contrato.

**Umbral por defecto**: 120 000 ms (2 min). Configurable por
`FRESHNESS_THRESHOLD_MS`. Fundamentación cuantitativa en BUG-02A
§7 — cubre el ciclo `RETRY_PERIOD_TICKS` del plugin (30 s) con 4×
de margen y captura todos los casos obsoletos observados en el
Event Store (lag ≥ 6 min).

**Implementación**: helper puro en `bot/src/handlers/freshness.ts`
(`isFreshEvent(event, thresholdMs)`, `computeLagMs(event)`). Los
handlers importan el helper y consumen `logger` y
`freshnessThresholdMs` de `DispatchContext`. No hay estado
persistente, no hay máquina de estados, no hay uso de `Date.now()`
— sólo aritmética sobre dos campos del propio `EventRecord`.

**Qué NO es freshness**:

- No es filtrar tipos de evento (eso lo hace la api con `types=`).
- No es deduplicación (eso lo hace `event_uuid` a nivel Event Store).
- No es control de estado (eso sería una máquina de estados
  aparte, descartada explícitamente en BUG-02A §6 por overkill).
- No es un cutoff temporal absoluto (no bloquea replays deliberados
  desde el inicio del mundo — un consumer analítico como Insight
  no aplica freshness, sólo los consumers editoriales).

## Preguntas abiertas para el dueño

Cosas que necesitan tu decisión antes de codificar:

1. **Nombre del bot** — ¿`mc-ecosystem-pulso`, `Pulso`, otro? Aparece
   como identidad en Discord y en el project name del compose.
2. **Un canal o dos** — ¿todos los posts al mismo canal, o separar
   *notable* (joins, logros, eventos) de *ambient* (muertes, samples)?
   Impacta config de canales.
3. **Menciones a jugadores** — cuando alguien logra un advancement,
   ¿mencionamos su usuario de Discord (si hay mapping) o sólo el nombre
   del jugador MC? El mapping player_uuid ↔ discord_user_id es una
   funcionalidad adicional a diseñar (puede ir en v1.1.x).
4. **Sesión 1 del roadmap** — ¿existe algún doc de la Sesión 1 v1.1
   Pulso que no encontré? Debería estar en `docs/` pero no lo hay. Si
   existe en otro sitio, reléelo yo puedo alinear este doc a lo que allí
   se decidió.
5. **Test guild** — ¿ya existe uno o hay que crearlo? Si hay que
   crearlo, es parte de la Sesión 3 (implementación) pero conviene
   avisar hoy para tener el guild listo cuando toque.

---

## Anexo: no-modificaciones

Este documento es diseño; **no toca**:
- Código en `bot/` (sigue con `.gitkeep`).
- `api/src/routes/` (ningún endpoint nuevo hasta aprobación).
- `docker-compose.*.yml` (sin servicio `bot` hasta aprobación).
- `packages/shared/` (sin tipos nuevos hasta aprobación).
- `infra/.env` (sin variables nuevas hasta aprobación).

Cuando cualquiera de las Decisiones 1-3 se apruebe, la conversión a
ADR y la implementación arrancan en sesiones separadas (Sesión 3 en
adelante del roadmap).
