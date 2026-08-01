# Phase 01 · Narrative · Complete

Cierre oficial de la primera fase del proyecto Pulso. Documento
de arquitectura y decisión técnica — no changelog, no roadmap. Todos
los números provienen de lectura directa del código en el commit de
este documento.

## 1. Objetivo de la fase

La fase Narrative tenía un propósito único: **construir el lenguaje
narrativo del servidor**.

Cuando arrancó el proyecto, Pulso era un consumidor genérico de
eventos que reenviaba lo que llegaba. En 24 tipos de evento
emitidos por el plugin ninguno tenía forma narrativa: eran
notificaciones técnicas de "algo pasó en Minecraft". La fase
Narrative se marcó como el trabajo de traducir ese stream técnico
al vocabulario de una crónica — decidir qué merecía ser publicado,
con qué tono, en qué forma y desde qué punto de vista.

La fase se estructuró como 11 tickets iterativos, cada uno
introduciendo un nuevo Chronicle sobre un evento distinto. Cada
Chronicle es una dimensión de la historia del servidor: muertes,
duelos, dimensiones descubiertas, hitos históricos, bosses caídos,
crafts significativos, trades notables, encantamientos endgame,
tecnología instalada, chunks generados por primera vez.

## 2. Qué se logró

Contadores extraídos del código actual:

| Métrica                                    | Valor |
|--------------------------------------------|-------|
| Chronicles narrativos                      | 11    |
| Handlers totales registrados               | 18    |
| Handlers narrativos                        | 11    |
| Handlers operativos (no-Chronicle)         | 7     |
| Catálogos en `bot/src/minecraft/`          | 11    |
| MessageKinds en `publisher/types.ts`       | 18    |
| MessageKinds con color en `embed-theme.ts` | 18    |
| Tipos de evento emitidos por el plugin     | 24    |
| Eventos consumidos por el bot              | 18    |
| Eventos deliberadamente ignorados          | 7     |

Correspondencias verificables:
- 18 handlers registrados en `bot/src/bootstrap/compose.ts`.
- 18 archivos `*-handler.ts` en `bot/src/handlers/`.
- 11 archivos `*-catalog.ts` en `bot/src/minecraft/` (10 con patrón
  VARIANTS + `advancement-catalog.ts` con patrón de traducción).
- 18 valores en el union type `MessageKind` de
  `bot/src/publisher/types.ts`, todos con entrada en `KIND_COLORS`
  de `bot/src/discord/embed-theme.ts`.
- 24 tipos de evento producidos por 8 listeners del plugin más
  MilestoneTracker (`plugin/src/main/java/com/mcecosystem/eventcollector/`).
- Los 18 tipos consumidos = 17 provenientes del plugin + 1 externo
  (`backup.done`).

## 3. Filosofía alcanzada

La fase termina con una filosofía consistente aplicada por los 11
Chronicles:

- **Pulso no replica Minecraft.** El canal de Discord no es un feed
  del chat ni un espejo del log del servidor.
- **Pulso no publica telemetría.** Los eventos periódicos
  (`position.sample`, `damage.minute`) y las alertas rutinarias
  (`server.tps_sample` cuando el TPS es sano) quedan fuera del
  canal.
- **Pulso publica historia.** Cada mensaje representa un
  acontecimiento — algo que un lector futuro reconocería como parte
  del recorrido del servidor.
- **Los mensajes representan acontecimientos, no notificaciones.**
  Un crafteo trivial (palos, antorchas) no dispara mensaje; un
  crafteo hito (beacon, ender chest, netherite_ingot) sí.
- **El protagonista principal es el servidor.** En 6 de los 11
  Chronicles (Server, Craft, Villager, Progress, Technology,
  Exploration) los handlers no llaman al `PlayerNameResolver` — la
  narrativa habla del mundo. En los otros 5 (Death, PvP, Dimension,
  Boss, Advancement) el nombre del jugador se interpola porque el
  actor humano ES parte del hecho.

Estos principios están documentados en detalle en
`docs/narrative-architecture.md` y aplicados consistentemente.

## 4. Cobertura narrativa

Tabla real de los 11 Chronicles cerrados en esta fase:

| Chronicle           | Evento             | Estado    | Handler                    | Catalog                          | MessageKind             |
|---------------------|--------------------|-----------|----------------------------|----------------------------------|-------------------------|
| Advancement         | `advancement.done` | Cerrado   | `AdvancementHandler`       | `advancement-catalog.ts`         | `advancement`           |
| Death               | `player.death`     | Cerrado   | `PlayerDeathHandler`       | `death-catalog.ts`               | `player_death`          |
| Dimension           | `dimension.enter`  | Cerrado   | `DimensionHandler`         | `dimension-catalog.ts`           | `dimension_first_enter` |
| Server (milestones) | `milestone.first`  | Cerrado   | `ServerMilestoneHandler`   | `server-milestone-catalog.ts`    | `server_milestone`      |
| Boss                | `boss.kill`        | Cerrado   | `BossKillHandler`          | `boss-catalog.ts`                | `boss_kill`             |
| PvP                 | `player.kill`      | Cerrado   | `PlayerKillHandler`        | `pvp-catalog.ts`                 | `player_kill`           |
| Craft               | `item.craft`       | Cerrado   | `CraftHandler`             | `craft-catalog.ts`               | `craft_milestone`       |
| Villager            | `villager.trade`   | Cerrado   | `VillagerTradeHandler`     | `villager-trade-catalog.ts`      | `villager_trade`        |
| Progress            | `item.enchant`     | Cerrado   | `ProgressHandler`          | `progress-catalog.ts`            | `progress`              |
| Technology          | `block.place`      | Cerrado   | `TechnologyHandler`        | `technology-catalog.ts`          | `technology`            |
| Exploration         | `chunk.first_load` | Cerrado   | `ExplorationHandler`       | `exploration-catalog.ts`         | `exploration`           |

Los 7 handlers restantes (`ServerStartedHandler`,
`ServerStoppedHandler`, `PlayerJoinedHandler`, `PlayerLeftHandler`,
`ChatHandler`, `TpsHandler`, `BackupHandler`) son operativos, no
narrativos: transmiten información de estado del servidor y de la
infraestructura sin catálogo de variantes.

## 5. Eventos pendientes

Actualmente existen eventos emitidos por el plugin que
deliberadamente NO generan Chronicle. La ausencia es una decisión,
no una tarea. Están clasificados por motivo:

**Telemetría**:
- `position.sample` — muestreo periódico de bioma/posición cada N
  segundos por jugador no-AFK. Un jugador quieto emite el mismo
  bioma cada minuto; no aporta señal narrativa por sí solo.
- `damage.minute` — agregado numérico de daño (dealt/taken/hits)
  cada 60 segundos por jugador con actividad. Es métrica, no
  historia.

**Spam / alta frecuencia sin valor consistente**:
- `block.break` — cada bloque roto. La inmensa mayoría es minería
  rutinaria; filtrar a "bloques significativos" produce un
  conjunto trivial (romper un beacon es raro y dramático, romper
  un bookshelf no cuenta historia).

**Poco valor narrativo**:
- `mob.kill` — mob matado por jugador. Combate PvE, mayoritariamente
  rutinario (zombie, esqueleto, creeper, araña). Filtrable a mobs
  élite pero el volumen resultante es muy bajo y ya está cubierto
  parcialmente por Boss Chronicle (Wither, Ender Dragon).
- `fishing.catch` — pesca exitosa. La mayoría son capturas comunes
  (raw_cod). Filtrable a rare loot pero el volumen resultante es
  demasiado nicho para un Chronicle propio.

**Falta de contexto**:
- `session.afk_start` — inactividad superó umbral. Es cambio de
  estado del jugador, no del mundo.
- `session.afk_end` — retorno tras inactividad. Idem.

Los 7 quedan disponibles en el stream — si el uso real revela una
necesidad narrativa concreta, un Chronicle podrá construirse sobre
ellos. Hoy no la revela.

## 6. Decisión arquitectónica

Se documenta explícitamente:

> **La fase Narrative se considera cerrada.**
>
> No se añadirán nuevos Chronicles únicamente para aumentar
> cobertura. Nuevos Chronicles sólo aparecerán cuando:
>
> - el plugin incorpore nuevos eventos que expresen semántica no
>   cubierta por los 11 Chronicles actuales,
>
> - el servidor evolucione hacia mecánicas que hoy no existen,
>
> - o el uso real del canal revele necesidades narrativas concretas
>   que los 11 Chronicles actuales no cubren.

La cobertura por sí sola no es objetivo. Los 7 eventos ignorados
descritos en la sección 5 pueden permanecer sin handler
indefinidamente sin que eso constituya deuda ni descuido. La regla
"si emite el plugin, publicar" no aplica ni ha aplicado en esta
fase — la selectividad es parte del diseño.

## 7. Estado de la deuda técnica

`docs/technical-debt.md` contiene 3 items abiertos: TD-001, TD-002,
TD-003. Este documento no los modifica.

De los tres, sólo **TD-003 · Extraer utilidad común para catálogos
narrativos** es consecuencia directa de esta fase. TD-003 registra
que 10 de los 11 catálogos comparten estructura idéntica (tipo
`Variant`, `VARIANTS: Record<Category, readonly Variant[]>`,
`_TO_CATEGORY: ReadonlyMap`, función `pickVariant` byte-a-byte
idéntica, contrato `narrateX(): string | null`, export `_INTERNAL`
para tests). El propio archivo TD-003 declara la extracción como
deferida hasta que aparezca una razón operativa concreta (bug en
`pickVariant`, cambio de política de aleatoriedad, tipos que ya no
cierren). Esa razón no ha aparecido en 11 tickets consecutivos; el
patrón no ha divergido en ningún catálogo.

El cierre de la fase no cambia el estado de TD-003. La duplicación
sigue siendo visible pero manejable, y su resolución se pospone
hasta que exista una necesidad operativa — no antes.

TD-001 y TD-002 son ortogonales a la fase Narrative y también
quedan en el estado en que estaban.

## 8. Próxima fase

Con la fase Narrative cerrada, el roadmap deja de centrarse en
generar mensajes. Ya existen 18 tipos de mensaje cubriendo 11
dimensiones narrativas del servidor. Añadir un 19º o un 12º no
aporta señal nueva; sólo diluye la existente.

La siguiente fase pasa a responder preguntas sobre lo que ya se
está capturando:

- ¿Qué significa lo que está ocurriendo en el servidor?
- ¿Qué patrones aparecen a lo largo del tiempo?
- ¿Qué tendencias emergen entre jugadores, entre dimensiones, entre
  actividades?
- ¿Qué está cambiando en el servidor semana a semana?
- ¿Qué momentos, vistos en retrospectiva, merecen ser conservados
  como historia canónica del mundo?

El nombre de la siguiente fase es **Insight**.

Su implementación no se describe en este documento.
