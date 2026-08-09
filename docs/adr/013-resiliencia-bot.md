# ADR-013: Resiliencia del bot — retry con circuit breaker + dead-letter queue

- **Fecha**: 2026-08-09
- **Estado**: aceptado
- **Fase del roadmap**: FASE A.3 · P1-5 + P2-5 (`docs/roadmap-consolidacion-v1.2-v2.0.md`)

## Contexto

El bot Pulso consume el Event Store (ADR-010) y publica en Discord.
Hoy, si el `send()` a Discord falla — 5xx transitorio, `Missing
Permissions`, rate limit sostenido, canal borrado, token rotado — el
handler lanza, el `PollingEngine` respeta correctamente su invariante
at-least-once y **el cursor jamás avanza** ([bot/src/polling/polling-engine.ts:174-220](../../bot/src/polling/polling-engine.ts)).
La misma línea vuelve indefinidamente hasta que un humano diagnostica
o el downstream se cura solo.

Este patrón se manifestó como **Incidente 001** (ver
`docs/runbook.md` · sección "Historial de incidentes"): el 2026-08-08
13:05:35 UTC llegó el evento `id=14173` (`type=backup.done`,
`event_uuid=b6e93a41-1e9d-4dd0-9719-443caf701dbe`); el bot no tenía
permisos `Send Messages` en el canal target del `BackupHandler`;
Discord devolvió `DiscordAPIError[50013] Missing Permissions`; el
consumer lanzó `PublishError`; el cursor se quedó clavado en
`event_id=14172` durante ~28 horas y acumuló ~500 eventos detrás.
El healthcheck del contenedor bot reportó `healthy` todo el tiempo
porque **mide conectividad con Discord, no capacidad efectiva de
publicar en canales**. El atasco fue invisible hasta un diagnóstico
manual disparado por casualidad durante el arranque de esta misma
FASE A.3.

El incidente es el caso 0 que motiva este ADR. Ninguna de sus
consecuencias fue accidental — todas son propiedades emergentes del
sistema actual:

- **Sin retry acotado**: cualquier fallo se propaga como excepción
  del handler, la iteración del polling falla, el cursor no avanza,
  el mismo mensaje se re-entrega en la próxima iteración cada ~5-30s
  hasta el fin de los tiempos.
- **Sin circuit breaker**: 28 horas de reintentos hostigando a la
  misma API que devuelve el mismo error. Ruido en logs, latencia
  arrastrada, cero recuperación.
- **Sin dead-letter queue**: no hay lugar auditable donde guardar
  "esto se descartó, por esto, aquí está el payload por si algún día
  se puede reproducir". El único registro son entradas de log
  repetidas 10.000 veces.
- **Sin observabilidad estructurada**: un `grep` por `event_uuid` en
  logs habría delatado la repetición en segundos; hoy el patrón es
  visible sólo tras leer varios KB de stack traces.

## Problema

Se necesita un mecanismo de resiliencia que:

1. **Acote el trabajo** de reintentos: cada evento fallido se reintenta
   un número finito de veces con delays crecientes; tras el tope se
   marca como resuelto vía DLQ y el sistema sigue.
2. **Proteja al downstream** durante caídas sostenidas: si Discord (o
   cualquier consumer) devuelve fallos en tanda, el bot deja de
   hostigarlo por un rato en vez de martillearlo hasta que ceda.
3. **Preserve la historia**: los eventos que no pudieron publicarse no
   se pierden — quedan en una tabla auditable con contexto suficiente
   para reproducirlos manualmente cuando la causa raíz se arregle.
4. **Nunca atasque el cursor**: cualquier evento que llegó al bot debe
   resolverse en un tiempo acotado — éxito o entrada explícita a DLQ.
   Ambos son "resuelto" desde la perspectiva del cursor.
5. **Sea observable**: cada intento fallido emite estructura JSON
   suficiente para que un solo `grep` por `event_uuid` responda "qué
   pasó con este mensaje".

## Decisión

### D1 · Retry: exponencial con jitter distribuido

Cada evento se reintenta hasta **5 veces** (1 intento inicial + 4
retries). Delays base: `200ms · 400ms · 800ms · 1600ms · 3200ms`,
duplicando cada paso (backoff exponencial), con **cap duro de 30 s**
por si algún futuro handler decide bases más grandes.

Cada delay lleva **jitter ±25% independiente** — el valor real se
sortea uniformemente en `[delay·0.75, delay·1.25]` cada vez. La
independencia es la propiedad clave: si dos eventos fallan
simultáneamente y ambos ven "el mismo delay", igual sus reintentos NO
caen a la vez porque cada uno sortea su jitter aparte. Evita el
thundering herd sobre el downstream justo cuando empieza a
recuperarse.

Tiempo total peor caso antes de mandar a DLQ:
`0 + 200 + 400 + 800 + 1600 + 3200 = 6.2 s` (± jitter). Cubre 99% de
blips de red o 5xx cortos de Discord.

### D2 · Circuit breaker: sliding window + half-open real

Estado del breaker: `closed` (default), `open`, `half_open`.

**Trigger de apertura**: **5 fallos consecutivos o intermitentes en
una ventana rodante de 60 s**. Se mantiene una lista timestamps de
los últimos N fallos; si `count(fallos donde ts >= now - 60s) >= 5`,
el breaker pasa a `open`. Se descartó "N consecutivos" porque un
downstream degradado alterna éxitos aislados y ese patrón mantendría
el breaker cerrado indefinidamente.

**Duración open**: **60 s fijos**. Todo evento nuevo que llega
durante open **NO llama al handler** — va directo a DLQ con
`reason='circuit_open'` (D3).

**Transición a half-open**: al cumplirse los 60 s, el breaker pasa a
`half_open`. En este estado se deja pasar **el siguiente evento real
que llegue** (no un ping sintético — el ADR-009 mantiene la API HTTP
como única superficie, y añadir un endpoint de "ping" al downstream
sería scope creep). Si ese evento **funciona**, el breaker cierra
(`closed`) y se limpia la ventana. Si **falla**, el breaker vuelve a
`open` por otros 60 s.

Justificación del "half-open con evento real": el diseño elimina la
necesidad de un probe artificial (no siempre existe algo tan trivial
como un HEAD `/ping` para Discord), y usa tráfico natural para
medir la salud. Coste: si el downstream sigue caído, un evento extra
va a DLQ cada 60 s. Aceptable — el volumen es <1 evento/40s en peak
(ver diagnóstico Incidente 001), y de todos modos ese evento iría a
DLQ.

### D3 · Comportamiento durante circuit abierto

**Regla dura**: mientras el breaker esté `open`, los eventos entrantes
NO se entregan al handler; van directamente a `dead_letter_events`
con `reason='circuit_open'`. Nada de buffer en memoria (se pierde en
restart) ni buffer en disco separado (duplica lo que la DLQ ya es).

**Principio de diseño destacado**: el cursor del bot avanza cuando el
evento está **resuelto**. Éxito publicando → resuelto. Envío
explícito a DLQ (por `max_retries`, `parse_error` o `circuit_open`)
→ resuelto. **Nunca se atasca en la cola.** Este principio es la
antítesis directa del Incidente 001 y es lo que impide que
`event_uuid=b6e93a41-…` vuelva a monopolizar el consumer durante 28 h.

Corolario operativo: cuando el breaker cierre (auto tras 60 s de
half-open exitoso, o manualmente arreglada la causa raíz), un job
periódico o el operador invocan `POST /admin/dlq/replay` (D8) para
reprocesar lo acumulado con `reason='circuit_open'`. La DLQ actúa
como buffer persistente natural.

### D4 · Logging estructurado (14 campos obligatorios)

Cada intento fallido — sea del handler, sea rechazo por circuit
abierto, sea envío a DLQ tras `max_retries` — emite **una** línea
JSON a stdout (Docker json-file driver ya rota logs, ver
`docker-compose.dev.yml` sección `bot`).

Campos obligatorios:

| Campo | Ejemplo |
|---|---|
| `correlation_id` | `b6e93a41-1e9d-4dd0-9719-443caf701dbe` (== `event_uuid`) |
| `event_id` | `"14173"` (string, blindaje del BIGINT) |
| `event_type` | `"backup.done"` |
| `attempt` | `1`, `2`, ... |
| `max_attempts` | `5` |
| `error_type` | `discord_5xx` \| `discord_rate_limit` \| `discord_missing_permissions` \| `parse_error` \| `circuit_open` \| `unknown` |
| `error_message` | Texto original truncado a 500 chars |
| `duration_ms` | Tiempo del intento fallido |
| `circuit_state` | `closed` \| `open` \| `half_open` |
| `will_retry` | `true` \| `false` |
| `retry_in_ms` | Sólo si `will_retry=true`; delay ya con jitter aplicado |
| `ts_first_attempt` | ISO-8601 del **primer** intento con este `event_uuid` |
| `ts_this_attempt` | ISO-8601 de **este** intento |
| `bot_version` | Version del bot (import de `package.json`); permite correlacionar bugs a deploys concretos |

Un solo `grep '"correlation_id":"<uuid>"' logs` reconstruye la vida
completa del evento — attempt 1 (error), attempt 2 (error), …,
attempt 5 (error final), DLQ insert. En el Incidente 001 este
`grep` habría contado 10.000+ instancias del mismo `event_uuid` y
detectado el atasco en el primer minuto.

### D5 · DLQ: tabla `dead_letter_events` en Postgres + rol `mc_dlq`

**Almacenamiento**: tabla nueva `dead_letter_events` en el mismo
Postgres que `events` (mismo servicio compose, mismo volumen
`pg-data`, mismo backup). Rechazado `dead-letter.jsonl` en disco
(no queryable, no atómico con el cursor, no viaja con los backups
regulares de restic).

**Rol dedicado `mc_dlq`** (mismo patrón que `mc_pruner` del
ADR-012 · least privilege):

- `mc_app` (identidad de la API HTTP): SELECT en `dead_letter_events`
  (para exponer lecturas si algún día se hace un endpoint), sin
  INSERT/UPDATE/DELETE.
- `mc_dlq` (identidad del path de escritura/replay): SELECT,
  INSERT, UPDATE de `replayed_at`. No DELETE (retención infinita —
  D7).

**Schema propuesto** (migración `003_dead_letter_events.sql`,
lección de FASE A.2 aplicada — commit del `.sql` **antes** de aplicar
al Postgres vivo):

```sql
CREATE TABLE dead_letter_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        TEXT        NOT NULL,     -- id::text del evento original
  event_uuid      UUID        NOT NULL,     -- correlation_id
  event_type      TEXT        NOT NULL,
  event_payload   JSONB       NOT NULL,     -- SNAPSHOT COMPLETO del evento
  reason          TEXT        NOT NULL,     -- 'max_retries' | 'parse_error' | 'circuit_open'
  error_type      TEXT        NOT NULL,     -- del D4
  error_message   TEXT        NOT NULL,
  attempts        INT         NOT NULL,
  first_failed_at TIMESTAMPTZ NOT NULL,
  last_failed_at  TIMESTAMPTZ NOT NULL,
  replayed_at     TIMESTAMPTZ,              -- NULL = pendiente; NOT NULL = replayed OK
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reason IN ('max_retries', 'parse_error', 'circuit_open', 'replay_failed'))
);

-- Dedupe natural de re-entregas (ver "Atomicidad cursor + DLQ" abajo).
CREATE UNIQUE INDEX ux_dlq_event_reason ON dead_letter_events(event_uuid, reason);

-- Consulta operativa clásica: "¿qué falta por resolver?"
CREATE INDEX ix_dlq_pending ON dead_letter_events(created_at) WHERE replayed_at IS NULL;
```

**`event_payload` JSONB como snapshot completo — razón crítica**:
copiar el evento entero (no sólo su `event_id`) protege contra la
purga programada del ADR-012. Si un evento va a DLQ hoy y su fila
original en `events` se archiva/purga en 24 meses, el replay
posterior sigue funcionando sólo con lo que hay en
`dead_letter_events`. Sin snapshot, la DLQ dependería de un
`SELECT ... FROM events WHERE id = X` que a los 24 meses devuelve
vacío.

**Campo `replay_failed` en el CHECK**: cubre el caso "intento de
replay que también fallara" — en ese caso NO se crea otra fila
(sería duplicado por la UNIQUE); se actualiza la existente y se
puede reclasificar como `replay_failed` si el operador lo decide.
Su presencia en el CHECK constraint desde el día 1 evita una
migración futura para reajustar el enum.

### D6 · Origen de las entradas a DLQ

Tres orígenes, mutuamente excluyentes, distinguidos por `reason`:

| `reason` | Cuándo | Retry previo | Cursor |
|---|---|---|---|
| `max_retries` | Handler falló las 5 veces del D1 | Sí (5 intentos con backoff) | Avanza al DLQ insert |
| `parse_error` | Evento no se puede deserializar/parsear (JSON malformado, campos requeridos ausentes, tipo desconocido sin handler registrado) | **No** — reintentar no va a arreglar JSON roto | Avanza al DLQ insert |
| `circuit_open` | Evento llegó mientras el breaker estaba open | **No** — el breaker existe precisamente para no intentar | Avanza al DLQ insert |

En los tres casos, **el cursor avanza al momento del INSERT en DLQ**
(ver "Atomicidad cursor + DLQ" abajo). La consecuencia directa: el
mismo `event_uuid` no puede monopolizar el consumer más de 6.2 s
(el peor caso del backoff del D1). El Incidente 001 se cierra
estructuralmente.

**NO** entran a DLQ: mensajes que fallaron uno o varios intentos
intermedios pero luego tuvieron éxito. Esos se loguean con
`will_retry=true` en cada intento y con éxito en el último — no
generan fila en la DLQ.

### D7 · Retención de la DLQ

**Retención infinita para arrancar**. Justificación: si el sistema
funciona, la DLQ tiene <100 filas totales — la mayoría del stack
funciona bien, los pocos eventos que caen a DLQ son o bien
excepcionales (bugs) o bien puntuales (permisos, outages). Si la
DLQ crece a miles, **eso mismo es la señal** de un problema
sistémico; retención automática enmascararía la alarma.

**TODO explícito**: implementar un warning cuando
`SELECT count(*) FROM dead_letter_events WHERE replayed_at IS NULL >
100`. Emitido por el bot al arrancar y periódicamente (mismo tick
que el scheduler de ADR-012, o similar). No es un healthcheck que
falla — sólo un log `WARN` con estructura estable que un futuro
sistema de alertas puede grep. Diseñar la alarma real queda
**fuera de scope** de este ADR (post-A.3).

Cuando (si) el volumen justifique retención automática, se aplicará
la plantilla del ADR-012: export a B2 con checkpoint SHA-256 + purga
verificada + tabla de bitácora. Reservado para un ADR-014
hipotético.

### D8 · Endpoint `POST /admin/dlq/replay`

Superficie HTTP en el `api` (no en el bot — mantiene la
convención del ADR-012 D3 y evita que el bot exponga sus propios
puertos administrativos).

**Autenticación**: header `X-Admin-Token` contra la variable
**`ADMIN_DLQ_TOKEN`** — **variable nueva, distinta de
`ADMIN_PRUNE_TOKEN`**. Justificación: rotación independiente
(comprometer una no compromete la otra), auditoría separable en
logs, y separación de responsabilidades operativas (quien tiene
acceso a "purgar events viejos" no necesariamente debe tener
acceso a "reproducir mensajes descartados" y viceversa). Generación
con `openssl rand -hex 32`; vive en `infra/.env`.

**Superficie de red**: idéntica al endpoint del ADR-012 — sólo
red interna de Docker Compose, NO expuesto por cloudflared/playit.

**Contrato**:

- `POST /admin/dlq/replay` sin body → replay de **todos** los
  `replayed_at IS NULL`, en orden `first_failed_at ASC`.
- `POST /admin/dlq/replay` con `{"id": 42}` → replay de una fila
  concreta por PK.
- `POST /admin/dlq/replay` con `{"reason": "circuit_open"}` →
  filtro por origen (útil tras un outage acotado).
- Respuesta JSON: `{replayed: N, still_failing: [{id, error_type, error_message}, ...]}`.

**Semántica del replay**: pone el evento de vuelta en el flujo del
bot (equivalente a re-emitir el handler con el `event_payload`
guardado). Si el replay **tiene éxito** → `UPDATE ... SET
replayed_at = now()`. Si **falla** de nuevo → NO crea otra fila
(la UNIQUE lo impediría); actualiza `attempts`, `last_failed_at`, y
opcionalmente `reason='replay_failed'` para distinguir.

Alcance del endpoint: **sólo lectura de la DLQ + re-emisión al bot**.
No manipula la tabla `events` original, no borra filas de DLQ, no
avanza cursores.

### D9 · Un solo ADR combinado

Este ADR-013 cubre retry + circuit breaker + DLQ como una sola
unidad de diseño. Las 8 decisiones anteriores tienen dependencias
cruzadas explícitas (D3↔D6, D2↔D4, D5↔D8, D1↔D6, atomicidad↔D5)
que se leen mejor juntas que fragmentadas en dos documentos con
referencias. Precedente: ADR-012 combinó política + implementación
+ activación en uno solo por el mismo motivo (y demostró funcionar).

---

### Atomicidad cursor + DLQ · Opción (b) con UNIQUE

**Decisión**: **insert en DLQ primero**, `cursor.save()` después.
Constraint `UNIQUE(event_uuid, reason)` sobre `dead_letter_events`
y el INSERT usa `ON CONFLICT (event_uuid, reason) DO NOTHING`.

**Racional específico a nuestro caso** (no genérico):

1. El at-least-once **ya existe y funciona** en el path de éxito
   del engine actual ([bot/src/polling/polling-engine.ts:174-220](../../bot/src/polling/polling-engine.ts)).
   La opción (b) hereda la misma semántica al path de fallo: si un
   crash ocurre entre "INSERT DLQ" y "cursor.save", en la próxima
   iteración el bot re-procesa el mismo batch, el segundo INSERT en
   DLQ hace no-op por la UNIQUE, y `cursor.save` corre limpio.
   **Simetría** con lo que ya está probado en producción.

2. **La ventana de crash es despreciable a este volumen**. Peak
   observado 90 events/hour ≈ 1 evento cada 40 s (medido en
   diagnóstico Incidente 001). La ventana entre "DLQ inserted" y
   "cursor saved" es del orden de milisegundos (una HTTP request al
   `api` más una `fs.rename` atómica). Para que se duplicara un
   evento en DLQ hace falta un crash EN esa ventana precisa —
   probabilidad efectiva ~0. Y si ocurriera, la UNIQUE lo neutraliza.

3. **Opción (a) — "cursor primero, DLQ después" — categóricamente
   descartada**: pierde el evento si crash intermedio. Contradice
   el propósito de la DLQ.

4. **Opción (c) — "mover cursor a Postgres para transacción única"
   — descartada por scope y ADR-009**. El cursor vive hoy en
   `cursor.json` (bind mount `./bot-data/`) con escritura atómica
   `writeFile(tmp) + rename(tmp, target)`. Moverlo a Postgres
   exigiría que el bot abra conexión directa a la DB rompiendo la
   superficie HTTP única del ADR-009. La transaccionalidad ganada
   es teórica (ventana de milisegundos) y el costo arquitectural
   es concreto (bot ahora depende de dos backends, migración del
   cursor existente, tests nuevos, cambio del ADR-009). Cambio
   grande para resolver un problema que la UNIQUE de (b) ya cubre.

5. **El cursor se guarda por batch, no por evento** (mismo engine).
   Las "windows de riesgo" por hora son mucho menores que el count
   de eventos — probablemente 60-100 batches/h en peak. Superficie
   de exposición aún menor de lo que sugiere el volumen crudo.

Consecuencia colateral positiva: si por alguna razón un evento
llegara dos veces al bot (retry de un consumer aguas arriba, glitch
del cursor), la UNIQUE `(event_uuid, reason)` garantiza que sólo
haya una fila en DLQ. La bitácora queda limpia sin lógica extra.

---

### Verificación de runtime (ADR-011)

Al terminar la implementación de este ADR, la sesión debe cerrar
con evidencia estilo:

```
Runtime verification:
  docker exec mc-ecosystem-postgres-1 psql -U mc -d mc_ecosystem \
    -c '\d dead_letter_events'
    → tabla existe con las 13 columnas + UNIQUE(event_uuid, reason)

  docker exec mc-ecosystem-bot-1 sh -c \
    'grep -c "circuit_state" /app/dist/**/*.js'
    → ≥1 (código del circuit breaker presente en runtime)

  docker exec mc-ecosystem-bot-1 printenv | grep -c 'RETRY\|CIRCUIT\|DLQ'
    → variables de config presentes

  docker exec mc-ecosystem-api-1 printenv ADMIN_DLQ_TOKEN | wc -c
    → 65 (64 hex chars + newline; token generado y presente)

  docker exec mc-ecosystem-api-1 sh -c \
    'curl -s -X POST http://localhost:3000/admin/dlq/replay -H "X-Admin-Token: bogus" | grep -c "token invalido"'
    → 1 (auth funciona, rechaza tokens bogus)
```

## Consecuencias positivas

- **El Incidente 001 no puede repetirse**. Cualquier fallo del
  handler tiene tope duro de 6.2 s antes de resolverse (éxito o
  DLQ). Cero atascos silenciosos.
- **Downstream protegido**: 5xx sostenidos de Discord dejan de
  hostigar al servicio caído tras 60 s de fallos; se probe con un
  evento real cada 60 s hasta que responde.
- **Trazabilidad completa**: cada evento tiene su historia
  reconstruible con un `grep '"correlation_id":"<uuid>"'` sobre
  logs, y todo lo descartado queda en `dead_letter_events` con
  contexto suficiente para reproducirlo.
- **Replay controlado**: cuando la causa raíz se arregla (permisos,
  código de handler, config), `POST /admin/dlq/replay` re-emite los
  eventos afectados en orden — sin editar cursor a mano, sin restart
  del bot.
- **Snapshot `event_payload` protege contra ADR-012**: los eventos
  en DLQ sobreviven a la purga programada de `events` — el replay
  a los 24 meses seguirá funcionando.
- **Tokens separados**: rotar `ADMIN_PRUNE_TOKEN` no afecta a los
  operadores que sólo tocan DLQ, y viceversa. Auditoría de accesos
  también separable.

## Consecuencias negativas

- **Un nuevo endpoint administrativo**: `POST /admin/dlq/replay`
  suma superficie a la del ADR-012 (el endpoint de prune ya existía).
  Mitigado por: mismo patrón de auth (header token, red interna
  únicamente), token nuevo separado, y coste operacional trivial
  (endpoint sin state, sin cron asociado). Adicionalmente
  `POST /admin/dlq` (writer usado por el bot para depositar entradas
  en la cola) y `GET /admin/dlq/pending-count` (usado por el monitor
  del D7) siguen el mismo patrón de auth y red.
- **Nuevo rol Postgres `mc_dlq`**: complica el diagrama de roles
  (`mc`, `mc_app`, `mc_pruner`, `mc_dlq`). Se documenta en el
  runbook — el patrón de least privilege compensa la complejidad.
- **Tabla adicional en Postgres**: `dead_letter_events` crece
  monotónicamente (D7). Se acepta con el TODO de warn a >100
  entradas pendientes. Si algún día pasa a miles, ADR-014 con la
  plantilla del ADR-012.
- **El half-open con "evento real" descarta un evento cada 60 s**
  si el downstream sigue caído. Aceptable: ese evento igual
  iría a DLQ; el diseño evita añadir un endpoint sintético de ping.
- **Complejidad de código**: retry + breaker + DLQ + logging es
  bastante más que un simple `try/catch/publish`. Se compensa
  encapsulando en módulos separables y bien testeados; tests
  unitarios cubriendo estados del breaker y cada `reason` de la
  DLQ.

## Alternativas descartadas

- **Retry con delay fijo o backoff lineal**: descartado en D1.
  Exponencial con jitter es el estándar de la industria y evita
  thundering herd en caídas coordinadas.

- **Circuit breaker por N fallos consecutivos** (Hystrix-style
  original): descartado en D2. Un downstream degradado que alterna
  éxito/fallo mantendría el contador reseteado indefinidamente.
  Sliding window refleja la salud real.

- **Buffer en memoria durante circuit abierto**: descartado en D3.
  Se pierde en restart. La DLQ ya es el almacén persistente
  natural — reusarla evita duplicación.

- **Buffer en disco separado** (archivo o SQLite embebido):
  descartado en D3. Duplica lo que Postgres ya hace, sin ganancia.

- **`dead-letter.jsonl` en disco** en vez de tabla Postgres:
  descartado en D5. Perdemos queryability, atomicidad transaccional
  con el cursor, y viajar con los backups regulares del bucket B2.

- **Reusar `ADMIN_PRUNE_TOKEN` para el endpoint de DLQ**:
  descartado en D8. Rotación acoplada, auditoría mezclada, cero
  ganancia operativa.

- **Retención automática de la DLQ desde el día 1** (rotación
  temporal o por volumen): descartado en D7. Enmascara la alarma
  de "la DLQ crece → hay un problema sistémico". Retención
  infinita + TODO de log warn > 100 es más honesto.

- **Mover el cursor a Postgres para transacción única cursor+DLQ**:
  descartado en la sección de atomicidad. Rompe ADR-009 (API HTTP
  como superficie única del bot al backend). La UNIQUE de (b)
  resuelve la duplicación sin refactor.

- **Health check "cursor avanzó en últimas N horas"** como parte
  de este ADR: anotado como TODO post-A.3 pero **fuera de scope**.
  Requiere definir "actividad esperada" (mundo con jugadores vs
  sin), umbrales por hora del día, etc. Bien diseñar por separado
  cuando haya más datos operacionales.

## Referencias cruzadas

- **ADR-009** — API HTTP como superficie única de la DB: se
  respeta explícitamente en la decisión de atomicidad (opción c
  descartada) y en la ubicación del endpoint (`api`, no bot).
- **ADR-010** — Consumo del Event Store por cursor `id`: el
  invariante at-least-once del engine (paso 5 del `pollOnce`) es
  la base sobre la que se construye este ADR.
- **ADR-011** — Runtime siempre coincide con código: aplicado en
  la sección "Verificación de runtime" al cierre.
- **ADR-012** — Política de retención de events: motiva el
  `event_payload` JSONB completo en la DLQ (protege contra la
  purga a 24 meses) y provee la plantilla del endpoint
  administrativo (`POST /admin/events/prune`).
- **`docs/runbook.md`** — sección "Historial de incidentes",
  **Incidente 001**: caso 0 que motiva este ADR. Toda decisión
  de este documento nace de una consecuencia observada en ese
  incidente.
- **`docs/roadmap-consolidacion-v1.2-v2.0.md`** — FASE A.3
  (P1-5 + P2-5).
- **[bot/src/polling/polling-engine.ts](../../bot/src/polling/polling-engine.ts)** —
  motor de polling actual, cuyo invariante at-least-once se
  preserva y extiende con retry+breaker+DLQ.
- **[bot/src/cursor/cursor-store.ts](../../bot/src/cursor/cursor-store.ts)** —
  `FileCursorStore` actual, cuya escritura atómica
  `writeFile+rename` se conserva sin cambios.
