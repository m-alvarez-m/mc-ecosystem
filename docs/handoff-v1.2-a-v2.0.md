# Handoff v1.2 → v2.0

- **Fecha de cierre v1.2**: 2026-08-12.
- **Tag firmado**: `v1.2` (ver `git show v1.2` para el mensaje).
- **Estado**: v1.2 cerrada con dignidad institucional; FASE D
  (Genesis → v2.0 Insight) queda como próximo hito.

Este documento consolida el estado del ecosistema al cerrar v1.2 y
sirve de arranque coherente para cualquier sesión futura (humana o
asistente) que retome el trabajo apuntando a FASE D. Es el "estado
del proyecto en un solo lugar" — no reemplaza a los ADRs, al runbook
ni al roadmap, los referencia.

## Fases cerradas de v1.2

Todas las fases del roadmap consolidado
(`docs/roadmap-consolidacion-v1.2-v2.0.md`) desde FASE A hasta
FASE C están ✅ con evidencia de CI + verificación humana donde
aplica:

### FASE A ✅ · Cimientos operacionales (cerrada 2026-08-10)

Convierte al bot de "funciona" a "es robusto".

- **A.1 · CI GitHub Actions** — commit `7d5a56a` · Actions run
  #109 verde (5 jobs OK, 1m 9s). Cada push a `main` ejecuta
  typecheck + tests en los 5 subproyectos.
- **A.2 · Retention policy + ADR-012** — commit `c43d4ee`. Ventana
  rodante 24 m; eventos vencidos archivados a Backblaze B2 con
  verificación SHA-256; 8 tipos perpetuos jamás archivados.
  Endpoint `POST /admin/events/prune` con token separado. Cron
  in-process (día 1 · 04:00 UTC). En `DRY_RUN=true` hasta ~2028-07.
- **A.3 · Retry + circuit breaker + DLQ** — commit `3fbc223` ·
  Actions run `31460451382`. ADR-013 firmado. `dead_letter_events`
  con snapshot completo del payload (protege contra la purga
  ADR-012); rol Postgres `mc_dlq` least-privilege; retry con jitter
  independiente + sliding window; monitor de saturación (warn si
  `pending > 100`). Endpoint `POST /admin/dlq/replay` con
  `ADMIN_DLQ_TOKEN` separado. Cierra estructuralmente el
  Incidente 001.

Cierre institucional de FASE A: commits `097b094` (cierre docs) y
`69ede32` (Vancorbus OP + ADR-014).

### FASE B ✅ · Slash commands (cerrada 2026-08-12)

Convierte al bot de "100 % reactivo" a "consultable bajo demanda".

- **B.1 · P2-1 Slash commands** — ADR-016 firmado en `65d0bff` ·
  implementación en `c50ca79` · regression fix en `f7314d9` · CI
  verde en run `31569178263` (5/5 gates, 55 s). Los 3 comandos
  (`/players`, `/tps`, `/status`) ephemeral, abiertos a todos los
  miembros del guild, registrados por-guild vía
  `npm run register-commands`. Endpoints nuevos api:
  `GET /players/online` + `GET /events/latest_by_type`.

Cerrada con verificación humana CP-6 (screenshots de los 3 comandos
en Discord) y con Incidente 004 documentado retroactivamente.

### FASE C ✅ · Higiene institucional (cerrada 2026-08-12)

- **C.1 · Runbook al día + tag `v1.2`** — el runbook incluye ya
  sección "Slash commands (B.1 · ADR-016)" + "Verificación antes de
  push · simular ambiente CI limpio" + los 4 Incidentes. Tag `v1.2`
  firmado en el commit de cierre.
- **C.2 · `bot/README.md` + handoff v1.2 → v2.0** — este documento
  + reescritura del README del bot con capacidades reales v1.2 (no
  "bootstrap inicial") y referencia a ADRs 011-016.

## ADRs firmados en v1.2

| ADR | Título | Fase | Estado |
|---|---|---|---|
| 011 | Runtime siempre debe coincidir con el código fuente | pre-A.1 (2026-08-03) | aceptado |
| 012 | Política de retención de `events` | A.2 (2026-08-08) | aceptado |
| 013 | Resiliencia del bot — retry + circuit breaker + DLQ | A.3 (2026-08-10) | aceptado |
| 014 | Checklist de nacimiento institucional | post-A.3 (2026-08-10) | aceptado |
| **015** | *Reservado* para FASE D.1 (Genesis → v2.0 Insight, renumeración de roadmap) | — | **pendiente** |
| 016 | Slash commands del bot Pulso (B.1) | B.1 (2026-08-11 firma, 2026-08-12 cierre) | aceptado |

Numeración institucionalizada: ADR-015 fue reservado explícitamente
en el ADR-014 sección "Corrección de numeración" para evitar
colisiones futuras. Ver `docs/adr/014-checklist-nacimiento-institucional.md`.

## Incidentes documentados en v1.2

Todos con retrospectiva completa (contexto, causa raíz, detección,
fix, aprendizaje) en `docs/runbook.md` sección "Historial de
incidentes".

| # | Nombre corto | Fecha | Aprendizaje estructural |
|---|---|---|---|
| 001 | Cursor del bot atascado por permisos Discord | 2026-08-03 → 2026-08-09 | Motiva ADR-013 (retry + breaker + DLQ). |
| 002 | EventFX no desplegado en prod | 2026-08-09 | Motiva ADR-014 CP-A (todos los `.jar` propios en el volumen). |
| 003 | Vancorbus no era OP en prod | 2026-08-09 (retroactivo desde 2026-07-26) | Motiva ADR-014 CP-B (dueño con OP level 4). |
| 004 | Rol Postgres `mc_dlq` sin flag LOGIN | 2026-08-10 → 2026-08-12 (retroactivo desde A.3) | Motiva extensión CP-D₂ del ADR-014 (verificación end-to-end contra sistemas dependientes con credenciales runtime, no sólo variable presente + código compilado). Queda como TODO para el próximo ADR. |

## Reglas institucionales activas al cerrar v1.2

Reglas operativas heredadas por cualquier sesión futura del proyecto,
guardadas también en la memoria persistente del asistente cuando
aplica:

1. **Nunca leer `.env` para verificar** — una lectura quema la clave;
   usar `grep -c '^VAR='` (cuenta sin exponer) o pedir confirmación
   al dueño (runbook · Checklist de nacimiento · item 1).
2. **Orden de migraciones SQL** — commit local del `.sql` ANTES de
   aplicar a la DB en vivo; sin excepciones (ADR-011).
3. **Minecraft: `op` es mutación, nunca query** — comandos de un
   verbo (`op`, `deop`, `ban`, `whitelist add`) son siempre
   mutaciones. Para ver ops se lee `/data/ops.json` (Incidente 003).
4. **Anti-flakiness en tests** (ADR-016 D6) — cualquier test que use
   RNG, tiempo real, o iteración sobre variantes debe mockear la
   fuente de no-determinismo. `it.each` con `Math.random()` sin mock
   queda prohibido como patrón.
5. **Pre-push env-clean** (runbook · Verificación antes de push) —
   `DISCORD_*= npm test` antes de `git push` para cazar leak-through
   desde el shell (motivado por regression `c50ca79`).
6. **Bot → api, nunca bot → DB** (ADR-009) — toda consulta de datos
   pasa por la api HTTP.
7. **Runtime = código** (ADR-011) — verificación en el artefacto
   vivo, no en el git log.
8. **Ante `password authentication failed` con credenciales
   verificadas** (Incidente 004) — el próximo paso es `\du <rol>` en
   `psql` como superuser, no reintentar la password.

## Estado runtime del ecosistema al cerrar v1.2

Snapshot cualitativo (los valores exactos cambian tick a tick; ver
`/status` slash command o `GET /health` para el vivo):

- Server Minecraft: **online** (uptime ~21 d al momento del cierre).
- Bot Pulso: **conectado a Discord**, polling activo cada 5 s, 3
  slash commands registrados en el guild.
- Api Fastify: **up**, endpoints v1.2 funcionales, incluidos los
  nuevos `/players/online` y `/events/latest_by_type` (B.1) y el
  `/admin/dlq/pending-count` (A.3 · post-fix Incidente 004).
- Postgres: rol `mc_dlq` **con flag LOGIN** (fix Incidente 004);
  tabla `events` creciendo bajo retención 24 m (DRY_RUN hasta 2028).
- DLQ pendientes: **0** (verificado end-to-end en el cierre B.1).
- Cursor del bot: **al día con `latest_id` del Event Store** (lag=0
  verificado en `/status` durante CP-6).

## Próximos pasos · FASE D · Cierre de Genesis como v2.0

El trabajo de Genesis (dashboard web) fue implementado por adelantado
bajo el número v4.0 en el roadmap original. Se reconoce ese trabajo,
se termina, se despliega a producción como v2.0 Insight, y se
renumera el roadmap.

Pasos exactos (extraídos del roadmap consolidado, con matices):

- **D.1** · Firmar **ADR-015** que documenta:
  (a) el traslado semántico "v4.0 Genesis" → "v2.0 Insight",
  (b) la renumeración del roadmap (v4.0 pasa a ser "Genesis IA con
  RAG", un producto distinto),
  (c) la extensión **CP-D₂** motivada por el Incidente 004 (para no
  arrastrar el TODO más allá de v2.0). Ver el aprendizaje de
  Incidente 004 en runbook para el borrador de CP-D₂.
- **D.2** · Terminar las features faltantes del dashboard según
  handoff Genesis (2-3 sesiones).
- **D.3** · Autenticación básica (BasicAuth o token en URL) antes de
  exponer Genesis fuera de la red interna. Aquí también encaja el
  TODO abierto en el runbook · Slash commands · "auth bot ↔ api"
  cuando el api deje de estar sólo en la red interna.
- **D.4** · Añadir Genesis al `docker-compose.prod.yml`.
- **D.5** · Runbook: sección "operación de Genesis (v2.0 Insight)".
- **D.6** · Verificación humana en vivo (CP-6 análogo al de B.1).
- **D.7** · Tag `v2.0`.

Estimación combinada: 3-5 sesiones.

## Cabos abiertos que sobreviven v1.2

Ninguno bloqueante. Los siguientes quedan explícitos para que la
sesión de FASE D los recoja en su primer ADR o al aterrizar D.3:

- **CP-D₂ del ADR-014** — extensión motivada por Incidente 004.
  Nombre operativo tentativo. Debe firmar en el próximo ADR
  (candidato: dentro de ADR-015 mismo, si el alcance encaja; o
  ADR-017 propio si merece separación).
- **Auth bot ↔ api** — documentado como TODO en runbook · sección
  Slash commands. Activo cuando el api se exponga fuera de la red
  interna de Docker Compose. FASE D.3 es su hogar natural.
- **HANDOFF-*.md untracked en `docs/`** — 9 archivos generados por
  una sesión previa que quedaron sin trackear. Decisión pendiente
  del dueño: (a) integrarlos al handoff v1.2 (este documento)
  seleccionando material vigente, (b) moverlos a un `docs/legacy/`,
  o (c) borrarlos. No urgente.

## Referencia rápida — comandos operativos

Para el operador (o la sesión) que retoma el proyecto en FASE D:

```bash
# Verificar salud del stack productivo:
docker ps --format "table {{.Names}}\t{{.Status}}"

# Salud del bot (JSON con runtimeState):
curl -sS http://localhost:3000/health | jq .

# Registrar/actualizar slash commands (idempotente):
cd bot && npm run register-commands

# Correr tests con env limpio antes de push:
DISCORD_BOT_TOKEN= DISCORD_CLIENT_ID= DISCORD_GUILD_ID= \
DISCORD_EVENTS_CHANNEL_ID= npm test

# Sanity DLQ (motivado por Incidente 004):
docker exec -it mc-ecosystem-postgres-1 psql -U postgres -c '\du mc_dlq'
```

Cualquier duda o cambio de contexto: leer primero el runbook (fuente
de verdad operativa) y este handoff (mapa institucional).
