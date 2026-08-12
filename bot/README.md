# Bot Pulso

Bot de Discord que expone en casi tiempo real la actividad del
ecosistema Minecraft (v1.2 · septiembre-agosto 2026). Consumidor
read-only del Event Store, resistente a fallos silenciosos, y
consultable bajo demanda vía slash commands.

## Estado v1.2

Servicio productivo. Suma cuatro capacidades cerradas con ADR:

- **Publicador de crónicas** (v1.1, ADR-008/009/010) — consume el
  Event Store por cursor `id` y publica narrativa determinista al
  canal Discord configurado. 18 handlers cubren deaths, kills,
  advancements, milestones, crafts, hitos de dimensión, chat,
  arranques del server, TPS bajo, y más.
- **Retention policy** (ADR-012, FASE A.2) — la tabla `events` no
  crece infinita: ventana rodante de 24 meses; eventos vencidos se
  archivan como JSONL gzipeado a Backblaze B2 y se purgan sólo tras
  verificar checksum SHA-256 remoto. 8 tipos perpetuos (deaths,
  kills, hitos, milestones) jamás se archivan. Cron mensual +
  endpoint `POST /admin/events/prune` on-demand con token separado.
  En modo `EVENTS_PRUNE_DRY_RUN=true` hasta ~2028-07.
- **Resiliencia** (ADR-013, FASE A.3) — retry con backoff
  exponencial + jitter independiente (200 ms → 3.2 s ± 25 %),
  circuit breaker sliding window (5 fallos/60 s abre, half-open con
  el próximo evento real), dead-letter queue (`dead_letter_events`)
  con snapshot completo del payload que protege contra la purga del
  ADR-012, monitor de saturación cada 1 h (warn si `pending > 100`),
  endpoint `POST /admin/dlq/replay` con token separado. Cierra
  estructuralmente el patrón de "cursor atascado silencioso"
  (Incidente 001).
- **Slash commands** (ADR-016, FASE B.1) — tres comandos ephemeral
  registrados por-guild:
  - **`/players`** — jugadores online, ordenados por tiempo de
    sesión, con bifurcación temporal `<24 h` relativo /
    `≥24 h` absoluto en `America/Monterrey`. TTL cache 10 s.
  - **`/tps`** — TPS 1 m con guardia de freshness 90 s. Sample
    rancio → mensaje explícito "no disponible".
  - **`/status`** — nueve líneas de salud del ecosistema: server
    on/off + uptime, jugadores, TPS, DLQ pendientes (evidencia
    silenciosa del ADR-013), último evento procesado, última alerta
    TPS bajo, versión + uptime del bot, cursor vs latest_id (lag).

Los 3 comandos read-only y abiertos a todos los miembros del guild
(precedente: lectura = abierto, mutación = admin). Ver
`docs/runbook.md` sección "Slash commands (B.1 · ADR-016)" para
registro operativo (`npm run register-commands`) y troubleshooting.

## ADRs firmados que gobiernan este bot

- [ADR-008 · stack del servicio Pulso](../docs/adr/008-stack-servicio-pulso.md)
- [ADR-009 · api HTTP como superficie única a la DB](../docs/adr/009-api-http-superficie-unica-db.md)
- [ADR-010 · consumo del Event Store por cursor `id`](../docs/adr/010-consumo-event-store-cursor-id.md)
- [ADR-011 · el runtime siempre debe coincidir con el código](../docs/adr/011-runtime-siempre-coincide-con-codigo.md)
- [ADR-012 · política de retención de `events`](../docs/adr/012-politica-retencion-events.md)
- [ADR-013 · resiliencia del bot (retry + circuit breaker + DLQ)](../docs/adr/013-resiliencia-bot.md)
- [ADR-014 · checklist de nacimiento institucional](../docs/adr/014-checklist-nacimiento-institucional.md)
- [ADR-016 · slash commands B.1](../docs/adr/016-slash-commands-b1.md)

Diseño de detalle del bot (pre-v1.1): [`docs/pulso-bot-design.md`](../docs/pulso-bot-design.md).
Handoff v1.2 → v2.0: [`docs/handoff-v1.2-a-v2.0.md`](../docs/handoff-v1.2-a-v2.0.md).

## Requisitos

- Node.js LTS (24 o superior).
- Variables de entorno (definir en `bot/.env` para dev, inyectadas
  desde `infra/.env` vía Docker Compose para deploy; cada aplicación
  del monorepo tiene su propio `.env` — ADR-014 CP-C aplica por
  servicio):
  - `DISCORD_BOT_TOKEN` — token del bot (Discord Developer Portal).
  - `DISCORD_CLIENT_ID` — application ID del bot (necesario para
    registrar slash commands · ADR-016 D2).
  - `DISCORD_GUILD_ID` — ID del servidor Discord destino.
  - `DISCORD_EVENTS_CHANNEL_ID` — canal donde el bot publica narrativa.
  - `PORT` — puerto HTTP para el endpoint `/health`.
  - `API_BASE_URL` — URL base de la api del Event Store.
  - `CURSOR_FILE` — ruta al archivo JSON de persistencia del cursor.
  - `POLL_INTERVAL_MS` — intervalo entre iteraciones del polling engine.
  - `ADMIN_DLQ_TOKEN` — opcional; si presente activa ADR-013 (DLQ),
    si ausente el bot corre en modo histórico (comportamiento pre-A.3).

Si falta cualquiera al arrancar, el servicio termina con `exit(1)`
listando qué falta. Sin fallbacks silenciosos.

## Scripts

- `npm run dev` — arranque con recarga vía tsx.
- `npm run build` — compila TypeScript a `dist/`.
- `npm run start` — corre el build compilado.
- `npm run test` — tests unitarios (vitest); v1.2 cierra con
  1183/1183 verdes.
- `npm run typecheck` — verifica tipos sin generar `dist` (cubre
  `src/` + el tsconfig de `scripts/`).
- `npm run register-commands` — registra los slash commands en el
  guild identificado por `DISCORD_GUILD_ID` (idempotente,
  fail-fast, log de evidencia). Ver runbook sección "Slash commands"
  para output esperado.

## Estructura

```
src/
├── index.ts               Entry point: config → compose → health → shutdown
├── config/env.ts          Carga tipada y validación fail-fast del .env
├── bootstrap/compose.ts   Grafo de dependencias del bot (composición pura)
├── discord/               Cliente Discord + publisher + sanitización
├── eventstore/            Cliente HTTP del Event Store (ADR-009/010)
├── polling/               Motor de polling con cursor `id` (ADR-010)
├── cursor/                Persistencia atómica del cursor en archivo
├── dispatcher/            Dispatcher + registro de handlers por tipo
├── handlers/              18 handlers (server, session, death, craft, TPS…)
├── minecraft/             Catálogos narrativos (crafts, deaths, dimensiones…)
├── players/               Resolver de nombres/UUIDs
├── observability/         RuntimeState + snapshot para /health y /status
├── health/                Servidor HTTP con /health
├── resilience/            ADR-013 · retry + circuit breaker + DLQ + monitor
├── slash/                 ADR-016 · /players, /tps, /status + router + cache
└── lifecycle/             Shutdown limpio SIGINT/SIGTERM
scripts/
└── register-commands.ts   Registro por-guild de slash commands (ADR-016 D2)
test/
└── (54 archivos, 1183 tests)
```

## Health

Endpoint único: `GET /health` en el `PORT` configurado. Responde
`200 {"status":"ok"}` cuando el cliente Discord está `ready`,
`503 {"status":"not-ready"}` mientras arranca. Serializa
`RuntimeState.snapshot()` con métricas del pipeline (procesados,
unknown, errores de polling/handler, timestamp del último evento,
último error registrado). El comando `/status` de Discord es la
vista humana equivalente para consulta bajo demanda.

## Reglas institucionales del bot

- **Anti-flakiness en tests** (ADR-016 D6, heredado del cierre de
  FASE A): cualquier test que use RNG, tiempo real, o iteración
  sobre variantes debe mockear la fuente de no-determinismo.
  `it.each` con `Math.random()` sin mock queda prohibido como
  patrón. Los handlers reciben `now: () => Date` inyectable.
- **Pre-push env-clean**: antes de `git push`, correr los tests con
  las variables de configuración vaciadas explícitamente para cazar
  leak-through desde el shell:
  ```bash
  DISCORD_BOT_TOKEN= DISCORD_CLIENT_ID= DISCORD_GUILD_ID= \
  DISCORD_EVENTS_CHANNEL_ID= npm test
  ```
  (Motivación: el commit `c50ca79` de B.1 rompió CI por este gap.
  Ver runbook sección "Verificación antes de push".)
- **Runtime = código** (ADR-011): ningún fix se considera resuelto
  hasta verificar del artefacto en runtime, no del git log.
- **Bot → api, nunca bot → DB** (ADR-009): toda consulta de datos
  pasa por la api HTTP; sin pool Postgres del lado del bot.
