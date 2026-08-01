# Narrative Architecture

Descripción del sistema narrativo actual del bot Pulso: catálogos,
handlers, MessageKinds y flujo de un evento del mundo al canal de
Discord. Este documento describe el estado del código en el momento
del commit `docs: add narrative architecture guide`.

No es un roadmap. No lista tareas pendientes. Cada afirmación es
verificable en el código actual.

## 1. Objetivo

Pulso es un bot de Discord que consume eventos del ecosistema
Minecraft (plugin `EventCollector` → API HTTP) y publica mensajes
en un canal.

Pulso no pretende replicar el chat de Minecraft. La superficie de
Discord es limitada — un feed continuo de bajo interés convierte el
canal en ruido. Pulso publica sólo cuando el evento tiene valor
narrativo: cada mensaje debe ser algo que un lector futuro reconozca
como parte de la historia del servidor.

Pulso tampoco publica todos los eventos que recibe. De los 24 tipos
que emite el plugin hoy, 17 tienen handler registrado; 7 se ignoran
deliberadamente por telemetría, alta frecuencia o falta de valor
narrativo (ver sección 8).

El protagonista principal de los mensajes es el servidor, no el
jugador. Cuando el jugador es imprescindible para la narración
(muertes, PvP, avances individuales) se le nombra; en las crónicas
que describen el crecimiento del mundo (Server Chronicle, Craft,
Villager, Progress, Technology, Exploration), el protagonista es el
servidor.

## 2. Flujo completo

```
Plugin (EventCollector, Bukkit/Paper)
    │  emite JSON por HTTP POST
    ▼
API (Fastify + Postgres)
    │  persiste + expone GET /events (cursor por id)
    ▼
Polling (bot/src/polling)
    │  intervalo configurable + cursor persistente
    ▼
Dispatcher (bot/src/dispatcher)
    │  routing por event.type; onUnknown / onHandled / onFailed
    ▼
Handler (bot/src/handlers/*.ts)
    │  extrae campos del payload; delega narrativa
    ▼
Narrative Catalog (bot/src/minecraft/*-catalog.ts)
    │  clasifica por lookup Map; retorna string | null
    ▼
Publisher (bot/src/publisher + bot/src/discord)
    │  aplica MessageKind → color/footer via embed-theme
    ▼
Discord (canal configurado)
```

Este es el diagrama oficial del sistema narrativo. Cada Chronicle
concreto sigue este flujo — no hay caminos alternativos.

## 3. Filosofía narrativa

Los principios aplicados por los handlers y catálogos actuales:

- **Narrativa impersonal cuando aplica**. Los hitos del servidor
  (crafts notables, trades destacados, encantamientos endgame,
  bloques tecnológicos, chunks nuevos, milestones históricos) hablan
  del mundo, no del jugador. Los handlers correspondientes no llaman
  al `PlayerNameResolver`.
- **Narrativa personal sólo cuando aporta valor**. Los eventos donde
  el actor humano ES la historia (muerte, PvP kill, avance individual,
  join/leave, chat) sí interpolan el nombre canónico del jugador.
- **Filtrar antes de publicar**. Cada handler decide si el evento
  merece un mensaje. Los catálogos retornan `null` cuando el payload
  no cae en su alcance. El publisher nunca ve lo descartado.
- **Evitar spam por eventos de alta frecuencia**. Los eventos de
  alto volumen (`block.place`, `chunk.first_load`, `item.craft`)
  usan filtros deterministicos y sin estado — items curados,
  rejillas de muestreo, umbrales de nivel — para que el canal siga
  siendo legible.
- **Evitar telemetría**. `position.sample`, `damage.minute` y
  `server.tps_sample` sano quedan fuera del canal por diseño. TPS
  se publica sólo cuando cae bajo el umbral (`tps_degraded`).
- **Aleatoriedad para no repetir frases**. Cada catálogo mantiene
  entre 6 y 8 variantes por categoría. La selección es
  `Math.floor(Math.random() * variants.length)`. Un mismo hito
  puede publicarse dos veces en la misma sesión sin decir lo mismo.
- **Cada Chronicle describe una dimensión distinta de la historia
  del servidor**. Death cuenta muertes; Exploration cuenta chunks
  nuevos; Progress cuenta encantamientos endgame; Technology cuenta
  bloques mecánicos. No hay dos Chronicles que se solapen sobre el
  mismo evento — cuando semánticamente cercanos (Craft vs
  Technology, Server Chronicle vs Dimension), ocupan momentos
  distintos del mismo objeto.

## 4. Catálogos implementados

| Chronicle           | Handler                    | Catálogo                          | Evento             | MessageKind             |
|---------------------|----------------------------|-----------------------------------|--------------------|-------------------------|
| Advancement         | `AdvancementHandler`       | `advancement-catalog.ts`          | `advancement.done` | `advancement`           |
| Death               | `PlayerDeathHandler`       | `death-catalog.ts`                | `player.death`     | `player_death`          |
| Dimension           | `DimensionHandler`         | `dimension-catalog.ts`            | `dimension.enter`  | `dimension_first_enter` |
| Server (milestones) | `ServerMilestoneHandler`   | `server-milestone-catalog.ts`     | `milestone.first`  | `server_milestone`      |
| Boss                | `BossKillHandler`          | `boss-catalog.ts`                 | `boss.kill`        | `boss_kill`             |
| PvP                 | `PlayerKillHandler`        | `pvp-catalog.ts`                  | `player.kill`      | `player_kill`           |
| Craft               | `CraftHandler`             | `craft-catalog.ts`                | `item.craft`       | `craft_milestone`       |
| Villager            | `VillagerTradeHandler`     | `villager-trade-catalog.ts`       | `villager.trade`   | `villager_trade`        |
| Progress            | `ProgressHandler`          | `progress-catalog.ts`             | `item.enchant`     | `progress`              |
| Technology          | `TechnologyHandler`        | `technology-catalog.ts`           | `block.place`      | `technology`            |
| Exploration         | `ExplorationHandler`       | `exploration-catalog.ts`          | `chunk.first_load` | `exploration`           |

Total: 11 Chronicles narrativos. Todos siguen el patrón de la
sección 6, excepto `Advancement` que usa un catálogo de traducción
(lookup ID → título oficial de Mojang) en lugar de pools de
variantes narrativas.

## 5. MessageKinds

Palette completa definida en `bot/src/discord/embed-theme.ts`. Cada
`MessageKind` del union type de `bot/src/publisher/types.ts` tiene
color asignado y se aplica al `EmbedBuilder` de discord.js.

| Kind                    | Color hex   | Chronicle / responsable                         |
|-------------------------|-------------|-------------------------------------------------|
| `server_started`        | `0x2ecc71`  | `ServerStartedHandler` (operativo)              |
| `server_stopped`        | `0xe74c3c`  | `ServerStoppedHandler` (operativo)              |
| `player_joined`         | `0x9be7a4`  | `PlayerJoinedHandler` (operativo)               |
| `player_left`           | `0x95a5a6`  | `PlayerLeftHandler` (operativo)                 |
| `player_death`          | `0x8b0000`  | Death Chronicle                                 |
| `advancement`           | `0x9b59b6`  | Advancement Chronicle                           |
| `chat`                  | `0x3498db`  | `ChatHandler` (operativo)                       |
| `tps_degraded`          | `0xf1c40f`  | `TpsHandler` (alerta operativa)                 |
| `backup`                | `0x808080`  | `BackupHandler` (operativo, evento externo)     |
| `dimension_first_enter` | `0x1abc9c`  | Dimension Chronicle                             |
| `server_milestone`      | `0xf39c12`  | Server (milestones) Chronicle                   |
| `boss_kill`             | `0xc0392b`  | Boss Chronicle                                  |
| `player_kill`           | `0xe74c3c`  | PvP Chronicle                                   |
| `craft_milestone`       | `0xf1c40f`  | Craft Chronicle                                 |
| `villager_trade`        | `0x27ae60`  | Villager Chronicle                              |
| `progress`              | `0x8e44ad`  | Progress Chronicle                              |
| `technology`            | `0x34495e`  | Technology Chronicle                            |
| `exploration`           | `0x2980b9`  | Exploration Chronicle                           |

Total: 18 MessageKinds. Un payload sin `kind` recibe
`NEUTRAL_COLOR = 0x546e7a` (retrocompatibilidad).

## 6. Arquitectura común

10 de los 11 catálogos narrativos comparten esta anatomía (excepción:
`advancement-catalog` que es de traducción). El patrón se aplica
consistentemente desde T8 hasta T17.

**Estructura interna de un catálogo narrativo típico**:

```
type Category = "A" | "B" | ...                         // enumerado cerrado
type Variant = (arg1, arg2, ...) => string              // función pura
const A: readonly Variant[] = [ () => "...", ... ]      // pool de variantes
const B: readonly Variant[] = [ ... ]
const VARIANTS: Readonly<Record<Category, readonly Variant[]>> = {
  A, B, ...
}
const RAW_TO_CATEGORY: ReadonlyMap<string, Category> = new Map([
  ["...", "A"],
  ["...", "B"],
])
function classify(...): Category | null { /* lookup */ }
function pickVariant(variants) {
  const idx = Math.floor(Math.random() * variants.length)
  return variants[idx]!
}
export function narrateX(input): string | null {
  const cat = classify(input)
  if (cat === null) return null
  return pickVariant(VARIANTS[cat])(...)
}
export const _INTERNAL = { VARIANTS, RAW_TO_CATEGORY, ... } as const
```

**Contrato con el handler**:

- El handler es un `implements EventHandler` puro: implementa
  `supports(eventType)` y `handle(context, event)`.
- El handler extrae los campos crudos del `EventRecord`, no hace
  IO adicional (excepto llamar al `PlayerNameResolver` cuando la
  crónica interpola nombre).
- El handler delega al catálogo (`narrateX(input)`).
- Si el catálogo retorna `null`, el handler termina en silencio
  (no publica, no lanza).
- Si retorna string, el handler llama a `context.publisher.publish
  ({ title, body, kind })`.

**Separación de capas**:

- Los catálogos no importan Discord ni HTTP ni el logger.
- El publisher (`bot/src/publisher`) define la interfaz `Publisher`
  con `PublishPayload` (title/body/kind) — sin referencias a Discord.
- La implementación concreta `DiscordPublisher` (`bot/src/discord`)
  traduce cada `PublishPayload` en un `EmbedBuilder` usando el
  color y footer que aporta `embed-theme.ts`.
- Los handlers dependen sólo del interfaz `Publisher`.

## 7. Eventos cubiertos

| Evento                | Consumido | Chronicle / Handler                       |
|-----------------------|-----------|-------------------------------------------|
| `server.start`        | Sí        | `ServerStartedHandler` (operativo)        |
| `server.stop`         | Sí        | `ServerStoppedHandler` (operativo)        |
| `server.tps_sample`   | Sí        | `TpsHandler` (alerta operativa)           |
| `session.start`       | Sí        | `PlayerJoinedHandler` (operativo)         |
| `session.end`         | Sí        | `PlayerLeftHandler` (operativo)           |
| `chat.message`        | Sí        | `ChatHandler` (operativo)                 |
| `player.death`        | Sí        | Death Chronicle                           |
| `player.kill`         | Sí        | PvP Chronicle                             |
| `advancement.done`    | Sí        | Advancement Chronicle                     |
| `boss.kill`           | Sí        | Boss Chronicle                            |
| `dimension.enter`     | Sí        | Dimension Chronicle                       |
| `milestone.first`     | Sí        | Server (milestones) Chronicle             |
| `item.craft`          | Sí        | Craft Chronicle                           |
| `item.enchant`        | Sí        | Progress Chronicle                        |
| `villager.trade`      | Sí        | Villager Chronicle                        |
| `block.place`         | Sí        | Technology Chronicle                      |
| `chunk.first_load`    | Sí        | Exploration Chronicle                     |
| `backup.done`         | Sí        | `BackupHandler` (operativo, evento externo)|

Total cubiertos: 18 tipos de evento (17 emitidos por el plugin +
1 externo).

## 8. Eventos deliberadamente ignorados

Estos tipos son emitidos por el plugin pero no tienen handler
registrado en `bot/src/bootstrap/compose.ts`. Ingresan al bot vía
polling y caen en `dispatcher.onUnknown`, que incrementa el
contador `runtimeState.unknownEventsTotal` y produce un log
`warn` — sin publicación en Discord.

| Evento               | Razón por la que no se publica                                                                                            |
|----------------------|---------------------------------------------------------------------------------------------------------------------------|
| `position.sample`    | Telemetría periódica (por defecto 60 s por jugador no-AFK). Un mismo jugador quieto emite el mismo bioma cada minuto.     |
| `damage.minute`      | Telemetría agregada por minuto (daño infligido/recibido). Métrica, no narrativa.                                          |
| `block.break`        | Alta frecuencia (cada bloque roto durante minería). Sin valor narrativo consistente. Su contraparte `block.place` sí se publica bajo filtro estricto (Technology Chronicle). |
| `mob.kill`           | Combate rutinario contra mobs. El plugin ya expone `boss.kill` como la variante narrativa relevante.                      |
| `fishing.catch`      | Coleccionismo repetitivo. Sin señal de progreso o de mundo cambiando.                                                     |
| `session.afk_start`  | Estado transitorio del jugador. No es un hito del mundo.                                                                  |
| `session.afk_end`    | Estado transitorio del jugador. No es un hito del mundo.                                                                  |

Total ignorados: 7 tipos. Los motivos vienen del comportamiento
del plugin (frecuencia real emitida) y de la política narrativa de
la sección 3.

## 9. Principios para nuevos Chronicles

Reglas arquitectónicas verificadas contra los 11 Chronicles
actuales:

- **Un catálogo por Chronicle**. El archivo `<name>-catalog.ts`
  vive en `bot/src/minecraft/`, exporta una función `narrateX` y
  un objeto `_INTERNAL` para tests estructurales.
- **Los catálogos son puros**. No hacen IO, no importan discord.js,
  no acceden al filesystem, no lanzan excepciones. Reciben datos
  ya extraídos, devuelven string o null.
- **Los catálogos no resuelven nombres**. Cuando el catálogo
  necesita el nombre canónico del jugador, el handler lo resuelve
  antes de llamar y lo pasa como argumento.
- **Los handlers son puros**. Sin estado, sin dedup local, sin
  cache (excepto `DimensionHandler` que sí mantiene un
  `Map<uuid, Set<dim>>` in-memory porque su semántica lo exige y
  la spec del ticket lo aprobó).
- **Los handlers no llaman al resolver si el catálogo no usa el
  nombre**. Craft, Villager, Progress, Technology, Exploration y
  Server (milestones para los 6 what canónicos) omiten la llamada
  al resolver — narración impersonal.
- **Los catálogos retornan `string | null`**. `null` significa "no
  publicar"; el handler termina en silencio sin lanzar.
- **Clasificación por lookup ReadonlyMap**. No hay `switch`
  gigantes ni cascadas de `if`. Cuando se necesita un check
  auxiliar (sufijo, umbral, prefijo), es una sola línea junto al
  lookup principal.
- **Aleatoriedad determinista para tests**. Los tests usan
  `vi.spyOn(Math, "random").mockReturnValue(0)` para verificar
  la primera variante de cada pool.
- **MessageKind único por Chronicle**. Cada nuevo Chronicle añade
  un valor al union type de `MessageKind`, un color en
  `KIND_COLORS`, y actualiza los tests estructurales de
  `embed-theme.test.ts` y `discord-publisher.test.ts`.
- **Publisher único, embeds únicos**. Los handlers nunca
  construyen embeds ni conocen colores. Toda la traducción de
  `PublishPayload` a `EmbedBuilder` vive en `DiscordPublisher`.
- **Registro explícito en `bootstrap/compose.ts`**. Sin
  auto-discovery. Añadir un handler = añadir una fila a
  `createHandlerRegistrations`.

## 10. Relación con la deuda técnica

`docs/technical-debt.md` documenta tres items abiertos hoy
(TD-001, TD-002, TD-003). Sólo uno afecta directamente al sistema
narrativo:

**TD-003 · Extraer utilidad común para catálogos narrativos**.
Registra que 10 de los 11 catálogos narrativos comparten
exactamente la misma anatomía descrita en la sección 6 — `Variant`,
`VARIANTS`, `_TO_CATEGORY` ReadonlyMap, `classify`, `pickVariant`
idéntico byte-a-byte, `narrateX` con contrato `string | null`,
export `_INTERNAL`.

TD-003 no se resuelve actualmente. La duplicación es visible pero
manejable: cada catálogo compila y testea de forma independiente;
`pickVariant` es de 3 líneas; el patrón no ha divergido en 10
tickets consecutivos. Extraer ahora tocaría 10 módulos productivos
y sus tests sin nuevo valor funcional. TD-003 seguirá deferido
hasta que aparezca una razón operativa concreta (un bug en
`pickVariant` que haya que arreglar en 10 sitios, cambio de
política de aleatoriedad, migración de tipos, etc.).

Este documento no modifica `docs/technical-debt.md`.

## 11. Estado actual

Números obtenidos por lectura directa del código en el commit de
este documento:

- **Handlers registrados** (`bot/src/bootstrap/compose.ts`): **18**.
- **Handlers narrativos (Chronicles)**: **11**.
- **Handlers operativos** (server up/down, sesiones, chat, TPS,
  backup): **7**.
- **Catálogos** en `bot/src/minecraft/*-catalog.ts`: **11**
  (10 narrativos con patrón VARIANTS + 1 de traducción para
  advancements).
- **MessageKinds** en `bot/src/publisher/types.ts`: **18**, todos
  con color asignado en `KIND_COLORS`.
- **Tipos de evento emitidos por el plugin**
  (`plugin/src/main/java/com/mcecosystem/eventcollector/`): **24**.
- **Tipos consumidos por el bot**: **17** del plugin + **1**
  externo (`backup.done`) = **18** en total.
- **Tipos deliberadamente ignorados**: **7** (ver sección 8).
