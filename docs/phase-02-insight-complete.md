# Phase 02 · Insight · Complete

Cierre oficial de la segunda fase del proyecto Pulso. Documento
de arquitectura, no changelog ni roadmap. Todos los números
provienen de lectura directa del código en el commit de este
documento.

## 1. Objetivos alcanzados

La fase Insight tenía un propósito único: **construir la capa de
conocimiento derivado sobre el Event Store**, sin modificar el
schema SQL, sin tablas nuevas, sin materialized views, sin caches,
sin IA, sin LLM, sin publicación en Discord.

La fase se estructuró en 5 tickets iterativos, cada uno una capa
sobre la anterior:

- **I1 · Query API** — Preguntas históricas planas sobre el Event
  Store: count, timeline, resumen de jugadores, perfil individual,
  resumen del servidor.
- **I2 · Aggregates** — Agregados reutilizables: heatmap horario,
  serie temporal diaria, rankings de jugadores y de tipos de evento.
- **I3 · Patterns** — Detección de patrones objetivos: peak/quiet
  hours, comparación con período anterior, jugadores recurrentes
  e inactivos, streaks de actividad.
- **I4 · Signals** — Composición temática de patrones en snapshots:
  activity, exploration, economy, players. Con clasificación de
  tendencia determinística.
- **I5 · Insight Engine** — Salida oficial de la fase: cada Insight
  combina un signal con severidad, confianza, evidencia y metadatos
  auditables bajo un contrato uniforme.

## 2. Arquitectura final

Cinco capas encadenadas. Cada capa consume sólo la inferior. Nadie
salta capas.

```
HTTP  →  Routes  →  Insights  →  Signals  →  Repository  →  PostgreSQL
```

- **HTTP**: Fastify + AJV (validación estricta de query/params).
- **Routes** (`api/src/routes/insight.ts`): handlers finos. Parsean
  entrada, delegan al layer correspondiente, serializan salida. Cero
  SQL, cero lógica de dominio.
- **Insights** (`api/src/insight/insights.ts`): registry de 4
  insights + generadores. Componen exactamente un signal (evidence)
  y añaden severidad + confianza + metadata.
- **Signals** (`api/src/insight/signals.ts`): 4 signals que
  componen funciones del repository. Cero SQL propio.
- **Repository** (`api/src/insight/repository.ts`): 13 funciones
  públicas + 4 helpers privados. Único punto donde vive SQL contra
  Postgres. Read-only (SELECT, sin UPDATE/DELETE/INSERT sobre
  `events`).
- **PostgreSQL**: tablas `events`, `players`, `player_names` con el
  esquema `api/db/001_init.sql` — **intacto durante toda la fase**.

## 3. Flujo completo

Un request desde el consumidor hasta la respuesta:

```
GET /insight/insights?from=2026-08-01T00:00Z&to=2026-08-08T00:00Z
    │
    ▼
routes/insight.ts        (Fastify + AJV validación)
    │
    ▼
insights.listInsights()  (invoca los 4 generadores en paralelo)
    │
    ├─▶ activityTrendInsight()      ─▶ signals.activitySignal()
    │                                    ├─▶ repo.growthPatterns()
    │                                    │    ├─▶ SQL: countEvents(current)
    │                                    │    ├─▶ SQL: countEvents(previous)
    │                                    │    ├─▶ SQL: activePlayers(current)
    │                                    │    └─▶ SQL: activePlayers(previous)
    │                                    └─▶ repo.activityPatterns()
    │                                         ├─▶ SQL: hourly histogram
    │                                         └─▶ SQL: daily group
    │
    ├─▶ explorationTrendInsight()   ─▶ signals.explorationSignal()
    │                                    └─▶ repo.countEvents() ×2
    │
    ├─▶ economyFocusInsight()       ─▶ signals.economySignal()
    │                                    └─▶ repo.countEvents() ×3
    │
    └─▶ playerEngagementInsight()   ─▶ signals.playersSignal()
                                         ├─▶ repo.playersSummary()
                                         └─▶ repo.playerPatterns()
                                              ├─▶ SQL: recurrent CTE
                                              └─▶ SQL: idle from players
    │
    ▼
Array<Insight> serializado como JSON
```

Total: 4 insights por request, cada uno con su cadena de queries
determinística. La misma request contra la misma DB produce
exactamente el mismo resultado (excepto `generatedAt`).

## 4. Capas existentes

Cinco archivos productivos dentro del módulo `api/src/insight/`:

| Archivo | Rol | SQL directo | Estado |
|---|---|---|---|
| `types.ts` | Contratos TypeScript de todas las respuestas | No | 570 líneas |
| `schemas.ts` | Esquemas AJV de validación HTTP | No | 147 líneas |
| `repository.ts` | Toda la SQL contra events/players/player_names | **Sí** | 717 líneas |
| `signals.ts` | Composición de repository en snapshots temáticos | No | 314 líneas |
| `insights.ts` | Registry de Insights + clasificación uniforme | No | 433 líneas |

Además: `api/src/routes/insight.ts` (396 líneas) que registra los
19 endpoints y delega a los layers de arriba.

## 5. Contratos públicos

### 5.1 · Endpoints (19 GET bajo `/insight/*`)

**I1 · Consultas planas** (5):
- `GET /insight/events/count?from=&to=&type=`
- `GET /insight/events/timeline?from=&to=&limit=`
- `GET /insight/players?from=`
- `GET /insight/player/:uuid`
- `GET /insight/server`

**I2 · Agregados** (4):
- `GET /insight/activity/hourly?from=&to=`
- `GET /insight/activity/daily?from=&to=`
- `GET /insight/players/top?from=&to=&limit=`
- `GET /insight/types/top?from=&to=&limit=`

**I3 · Patrones** (4):
- `GET /insight/patterns/activity?from=&to=`
- `GET /insight/patterns/growth?from=&to=`
- `GET /insight/patterns/players?from=&to=&minActiveDays=&idleThresholdDays=`
- `GET /insight/patterns/streaks?from=&to=`

**I4 · Signals** (4):
- `GET /insight/signals/activity?from=&to=`
- `GET /insight/signals/exploration?from=&to=`
- `GET /insight/signals/economy?from=&to=`
- `GET /insight/signals/players?from=&to=&minActiveDays=&idleThresholdDays=`

**I5 · Insights** (2 · **salida oficial**):
- `GET /insight/insights?from=&to=`
- `GET /insight/insights/:id?from=&to=`

### 5.2 · Contrato uniforme de Insight

Todos los insights comparten esta estructura:

```typescript
interface Insight<Facts> {
  id:          "activity-trend" | "exploration-trend" | "economy-focus" | "player-engagement";
  category:    "activity" | "exploration" | "economy" | "players";
  severity:    "normal" | "low" | "high" | "critical";
  confidence:  "low" | "medium" | "high";
  generatedAt: string;   // ISO 8601
  window:      { from: string; to: string };
  facts:       Facts;    // shape específico por insight
  evidence:    string[]; // signals consumidos
  metadata: {
    severityThresholds:   Record<string, number>;
    confidenceThresholds: { medium: number; high: number };
    engineVersion:        string;
  };
}
```

### 5.3 · Contrato inmutable de I1 (respetado por I2-I5)

- `POST /events` y `GET /events` de la API original no cambiaron.
- `GET /players/:uuid` no cambió.
- Ningún endpoint de las fases Insight escribe en la DB. La API
  sigue siendo append-only sobre `events`.

## 6. Estado del Event Store

**No modificado durante la fase Insight.** El schema `api/db/001_init.sql`
sigue siendo la versión inicial de v1:

- Tabla `events` (append-only): `id BIGINT PK, event_uuid UUID
  UNIQUE, type TEXT, v SMALLINT, ts TIMESTAMPTZ, received_at
  TIMESTAMPTZ, player_uuid UUID, world TEXT, x INT, y INT, z INT,
  data JSONB`.
- Índices: `ux_events_uuid`, `ix_events_type_ts`,
  `ix_events_player_ts`.
- Tabla `players` (mutable en `name`/`last_seen`).
- Tabla `player_names` (append-only, historial de renombres).
- Rol `mc_app` con SELECT + INSERT en `events` (UPDATE/DELETE/TRUNCATE
  explícitamente revocados).

Cero migraciones nuevas. Cero índices adicionales. Cero materialized
views. Cero triggers. Cero tablas satélite.

## 7. Estado de Repository

**Archivo**: `api/src/insight/repository.ts` — **717 líneas**.

**Funciones públicas** (13): `countEvents`, `timelineEvents`,
`playersSummary`, `playerInsight`, `serverInsight`, `activityByHour`,
`activityByDay`, `topPlayers`, `topEventTypes`, `activityPatterns`,
`growthPatterns`, `playerPatterns`, `streakPatterns`.

**Helpers privados** (4): `sumCountsAsString`, `countEventsInRange`,
`activePlayersInRange`, `safeRatio`.

**Responsabilidad única**: SQL contra `events`, `players`,
`player_names`. Cero SQL en cualquier otro archivo del módulo.
Read-only. Sin acoplamiento a HTTP, sin lógica de composición, sin
clasificación de severidad.

**No modificado en I5.** El repository quedó cerrado tras I3; ni I4
ni I5 le añadieron una línea. Los signals e insights consumen
exclusivamente lo que ya existe.

## 8. Estado de Signals

**Archivo**: `api/src/insight/signals.ts` — **314 líneas**.

**Signals públicos** (4):
- `activitySignal` → compone `growthPatterns` + `activityPatterns`.
- `explorationSignal` → 2×`countEvents` (current/previous, filtrado
  por `chunk.first_load`).
- `economySignal` → 3×`countEvents` (villager.trade/item.craft/item.enchant).
- `playersSignal` → compone `playersSummary` + `playerPatterns`.

**Helpers privados** (3): `deriveTrend`, `safeRatio`,
`computePreviousWindow`.

**Responsabilidad única**: composición de resultados del repository
en snapshots temáticos. Cero SQL propio (todo delega al repo). Cero
IO fuera del pool.

**No modificado en I5.** Los insights consumen los 4 signals sin
duplicar su lógica.

## 9. Estado de Insights

**Archivo**: `api/src/insight/insights.ts` — **433 líneas**.

**Insights públicos** (4):
- `activity-trend` — evidence: `["activitySignal"]`.
- `exploration-trend` — evidence: `["explorationSignal"]`.
- `economy-focus` — evidence: `["economySignal"]`.
- `player-engagement` — evidence: `["playersSignal"]`.

**API pública** (2 funciones + 1 constante):
- `listInsights(pool, {from, to})` → array de los 4 insights.
- `getInsight(pool, id, {from, to})` → uno por id, o `null`.
- `KNOWN_INSIGHT_IDS` → lista estable de ids soportados.

**Helpers privados** (5): `deriveConfidenceFromSample`,
`deriveConfidenceWithBaseline`, `deriveTrendSeverity`,
`deriveEconomySeverity`, `derivePlayerSeverity`, `safeShare`,
`nowIsoDefault`.

**Constantes documentadas** (5, todas visibles en la respuesta vía
`metadata`): `ENGINE_VERSION`, `CONFIDENCE_SAMPLE_THRESHOLDS`,
`TREND_SEVERITY_THRESHOLDS`, `ECONOMY_SEVERITY_THRESHOLDS`,
`PLAYER_SEVERITY_THRESHOLDS`.

**Responsabilidad única**: componer un signal y clasificarlo bajo
el contrato uniforme (severity + confidence + metadata). Cero SQL,
cero acceso directo al repository, cero acoplamiento HTTP.

## 10. Métricas finales

Números verificados por lectura del código en este commit:

| Métrica | Valor |
|---|---|
| Endpoints `/insight/*` totales | **19** |
| Endpoints de I1 (consultas) | 5 |
| Endpoints de I2 (agregados) | 4 |
| Endpoints de I3 (patrones) | 4 |
| Endpoints de I4 (signals) | 4 |
| Endpoints de I5 (insights) | 2 |
| Signals soportados | **4** |
| Insights soportados | **4** |
| Funciones públicas en repository | 13 |
| Helpers privados en repository | 4 |
| Migraciones SQL nuevas en la fase | **0** |
| Tablas nuevas | 0 |
| Índices nuevos | 0 |
| Materialized views | 0 |
| Triggers | 0 |
| Cambios en plugin | 0 |
| Cambios en bot (regresión) | 0 |
| Tests de API | **186** (10 archivos) |
| Tests de bot (regresión final) | 1070/1070 (sin cambios) |
| Typecheck API | limpio |
| Typecheck Bot | limpio |

## 11. Preparación para Dashboard

La fase Insight cierra dejando el sistema listo para consumidores
externos. A partir de este punto:

- **Dashboards** deben consumir `/insight/insights` (recomendado)
  o `/insight/insights/:id` para vistas específicas. La respuesta
  incluye severity + confidence + facts + evidence — datos
  suficientes para renderizar sin lógica adicional en el cliente.
- **Automatizaciones** (alertas, notificadores) deben consumir
  `/insight/insights/:id` filtrando por `severity == "critical"` o
  `severity == "high"` según su política.
- **Futuros generadores de lenguaje natural** (roadmap posterior)
  deben consumir insights, no signals ni patterns. Los facts +
  evidence + metadata dan al generador todo lo necesario para
  producir texto sin volver a consultar la DB.
- **Consumidores heredados** (los 11 Chronicles del bot Pulso)
  siguen funcionando sin cambios — la fase Insight vive
  exclusivamente en la API y no toca el bot.

Los layers inferiores (`/insight/events/*`, `/insight/activity/*`,
`/insight/patterns/*`, `/insight/signals/*`) permanecen accesibles
como contratos públicos para casos donde el consumidor necesita
granularidad mayor que el Insight Engine. Se recomienda usar el
Insight Engine como punto de entrada por defecto.

El schema del Event Store queda intacto para futuras fases. Cualquier
optimización (índices funcionales, particiones, agregados
precomputados) queda como oportunidad — no como deuda.

**La fase Insight se considera oficialmente cerrada.**
