# Catálogo de Eventos — Contrato del sistema

> Este archivo es la fuente de verdad entre el plugin (Java) y la API (TypeScript).
> Regla: NINGÚN evento se emite, cambia o interpreta sin actualizar este documento primero.
> Los eventos son inmutables y append-only. Las correcciones se hacen con nuevos eventos, jamás con UPDATE/DELETE.

## Decisiones vigentes
- **Chat (A):** se registra el CONTENIDO completo de los mensajes. Consentimiento explícito de todos los jugadores otorgado en julio 2026. Si entra un jugador nuevo, debe aceptar antes de su primer login (anotarlo aquí con fecha).
- **Posición (B):** muestra cada 60 s por jugador conectado y no-AFK.
- **Daño (C):** agregado por minuto por jugador, no por golpe.
- Timestamps siempre en **UTC**. La clave de jugador es siempre el **UUID**; el nombre es solo un atributo histórico.

## Esquema de la tabla `events` (v1)

```sql
CREATE TABLE events (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_uuid   UUID        NOT NULL,            -- generado por el plugin (idempotencia)
  type         TEXT        NOT NULL,
  v            SMALLINT    NOT NULL DEFAULT 1,  -- versión del esquema del tipo de evento
  ts           TIMESTAMPTZ NOT NULL,            -- cuándo ocurrió (lo pone el plugin)
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(), -- cuándo llegó a la DB
  player_uuid  UUID,                            -- NULL en eventos de servidor
  world        TEXT,
  x INT, y INT, z INT,
  data         JSONB       NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX ux_events_uuid   ON events(event_uuid);
CREATE INDEX ix_events_type_ts       ON events(type, ts);
CREATE INDEX ix_events_player_ts     ON events(player_uuid, ts);
-- Append-only: al rol de la aplicación se le revocan UPDATE y DELETE sobre events.
```

## Tablas satélite (v1)

```sql
CREATE TABLE players (
  uuid        UUID PRIMARY KEY,
  name        TEXT NOT NULL,          -- nombre actual
  first_seen  TIMESTAMPTZ NOT NULL,
  last_seen   TIMESTAMPTZ NOT NULL
);

CREATE TABLE player_names (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_uuid UUID NOT NULL REFERENCES players(uuid),
  name        TEXT NOT NULL,
  seen_at     TIMESTAMPTZ NOT NULL
);
```

Ninguna otra tabla existe en v1. Rankings, títulos y récords serán tablas DERIVADAS (recalculables desde `events`) y llegarán con Insight.

---

## Eventos v1

Convención de nombres: `dominio.accion`, en inglés, minúsculas. Campos comunes (`event_uuid, type, v, ts, player_uuid, world, x, y, z`) no se repiten abajo; solo se documenta el contenido de `data`.

### Sesión
| type | data | Notas |
|---|---|---|
| `session.start` | `{ "ip_hash": str? }` | Al hacer login. IP solo hasheada, nunca en claro |
| `session.end` | `{ "duration_s": int, "reason": "quit"\|"kick"\|"server_stop" }` | duration desde session.start |
| `session.afk_start` | `{}` | Sin input por 5 min |
| `session.afk_end` | `{ "afk_duration_s": int }` | |

### Bloques
| type | data | Notas |
|---|---|---|
| `block.break` | `{ "block": "minecraft:diamond_ore", "tool": "minecraft:netherite_pickaxe", "silk": bool, "fortune": int }` | Base de Rey Minero |
| `block.place` | `{ "block": str }` | Base de Gran Constructor |

### Combate
| type | data | Notas |
|---|---|---|
| `player.death` | `{ "cause": str, "killer_uuid": uuid?, "killer_mob": str?, "message": str }` | pos = lugar de muerte (cementerio) |
| `player.kill` | `{ "victim_uuid": uuid, "weapon": str? }` | PvP. Base de Gladiador y rivalidades |
| `mob.kill` | `{ "mob": "minecraft:creeper", "weapon": str? }` | |
| `damage.minute` | `{ "dealt": float, "taken": float, "hits_dealt": int, "hits_taken": int }` | Agregado por minuto (decisión C). Solo se emite si hubo combate |

### Progreso e hitos
| type | data | Notas |
|---|---|---|
| `advancement.done` | `{ "advancement": str }` | |
| `dimension.enter` | `{ "dimension": "the_nether" }` | |
| `milestone.first` | `{ "what": "nether"\|"end"\|"diamond"\|"elytra"\|... }` | Primera vez EN EL SERVIDOR (no por jugador) |
| `boss.kill` | `{ "boss": "ender_dragon"\|"wither", "participants": [uuid] }` | |

### Mundo y movimiento
| type | data | Notas |
|---|---|---|
| `chunk.first_load` | `{ "chunk_x": int, "chunk_z": int }` | Quién exploró qué. player = descubridor |
| `position.sample` | `{ "biome": str }` | Cada 60 s, no-AFK (decisión B). pos en columnas |

### Economía e ítems
| type | data | Notas |
|---|---|---|
| `villager.trade` | `{ "profession": str, "input": str, "output": str, "count": int }` | |
| `item.craft` | `{ "item": str, "count": int }` | |
| `item.enchant` | `{ "item": str, "enchants": [{"id": str, "lvl": int}], "cost_levels": int }` | |
| `fishing.catch` | `{ "item": str }` | |

### Social
| type | data | Notas |
|---|---|---|
| `chat.message` | `{ "content": str, "length": int }` | CONTENIDO COMPLETO (decisión A, con consentimiento). Alimenta crónicas de Genesis |

### Servidor (player_uuid = NULL)
| type | data | Notas |
|---|---|---|
| `server.start` | `{ "mc_version": str, "plugins": [{"name": str, "version": str}] }` | Registro de versiones por arranque |
| `server.stop` | `{ "uptime_s": int }` | |
| `server.tps_sample` | `{ "tps_1m": float, "mspt": float, "players_online": int, "ram_used_mb": int }` | Cada 60 s |
| `backup.done` | `{ "kind": "world"\|"db", "size_mb": int, "ok": bool }` | |

### Eventos de servidor — Modo Evento (player_uuid = NULL) · desde 2026-07-17
| type | data | Notas |
|---|---|---|
| `event.start` | `{ "name": str, "kind": "torneo_ki", "participants": [uuid], "assignments": [{"player": uuid, "skin": str}] }` | Abre una ventana de Modo Evento. `assignments`: skin asignada a cada participante (via SkinsRestorer) |
| `event.end` | `{ "name": str, "duration_s": int }` | Cierra la ventana abierta por el `event.start` del mismo `name` |

> **Nota para Insight**: las ventanas entre `event.start` y `event.end` se
> EXCLUIRÁN de las estadísticas normales (o se contarán como categoría
> propia) cuando lleguen los workers de Insight. Lo que pasa en un torneo
> (kills, muertes, daño) no debe contaminar rankings como Gladiador.

### Modo Evento — Haunting (player_uuid = NULL) · desde 2026-07-18
| type | data | Notas |
|---|---|---|
| `haunt.appearance` | `{ "target": uuid, "skin": str, "distance": float, "duration_s": float, "seen": bool }` | Aparición fantasma visible SOLO para `target`. pos = dónde estuvo el NPC. `seen`: si el objetivo llegó a tenerlo en su cono de visión |
| `haunt.sound` | `{ "target": uuid, "sound": str }` | Sonido ambiental falso reproducido solo para `target`. pos = origen aparente del sonido |

> Ambos se emiten al ocurrir, nunca se anuncian al jugador. La gracia del
> haunting es que los datos sepan la verdad y el jugador no.

### Manuales (se crean desde la API/web, no desde el plugin)
| type | data | Notas |
|---|---|---|
| `project.registered` | `{ "name": str, "authors": [uuid], "description": str, "photos": [url] }` | pos = ubicación de la construcción |
| `base.registered` | `{ "name": str, "residents": [uuid] }` | |

---

## Reglas de evolución del catálogo
1. **Agregar un campo nuevo a `data`** de un tipo existente → sube `v` de ese tipo (v1→v2) y documenta aquí ambas versiones. Los eventos viejos siguen siendo válidos con su `v`.
2. **Agregar un tipo nuevo de evento** → se agrega aquí PRIMERO, con fecha de inicio, y luego al plugin.
3. **Nunca** se renombra un `type` existente ni se reinterpreta un campo. Si el significado cambia, es un tipo nuevo.
4. Cada cambio a este archivo = un commit propio con mensaje `catalog: ...`.

## Registro de cambios
- **2026-07-18** · Nuevos tipos `haunt.appearance` y `haunt.sound` (Modo Evento — Haunting, v1).
- **2026-07-17** · Nuevos tipos `event.start` y `event.end` (Modo Evento, v1). Las ventanas de evento se excluirán de las estadísticas normales o tendrán categoría propia en Insight.
- **2026-07** · v1 inicial. Decisiones A (chat con contenido, consentimiento de todos), B (posición 60 s), C (daño por minuto).
