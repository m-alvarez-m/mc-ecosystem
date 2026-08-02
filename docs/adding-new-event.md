# Añadir un evento nuevo al catálogo

Guía procedimental para introducir un tipo de evento nuevo. La regla es
simple pero **no negociable**: se documenta primero (`docs/event-catalog.md`),
luego se implementa el emisor, luego se verifica en la DB. Cualquier
orden distinto se degrada rápido — o el catálogo miente, o el plugin
emite eventos que nadie sabe interpretar.

## Cuándo añadir un evento nuevo

Un tipo nuevo se justifica cuando:

- Captura un hecho **no derivable** de los tipos existentes. Si se puede
  calcular con una query sobre lo que ya emitimos (ej. "muertes por
  bioma" desde `player.death + position.sample`), no es un evento
  nuevo — es una vista/consulta.
- Representa una **acción o transición discreta** con timestamp claro.
  Estados continuos no son eventos; sus transiciones sí (ej. no
  `player.online`, sí `session.start` / `session.end`).
- Va a informar **analytics, narrativa, rankings o incidentes**. Si
  nadie va a consultarlo, no vale la deuda del schema.

Si no encaja, considera antes: (a) reusar un tipo existente con
`data` diferente, (b) mover la lógica a un cálculo derivado en Insight.

## Checklist completo

Orden estricto. Cada paso deja evidencia (commit, log, query) antes
de pasar al siguiente.

1. **Diseñar el schema** — nombre `dominio.accion` (inglés, minúsculas),
   qué va en `data`, si tiene `player_uuid`, si tiene posición
   (`world`/`x`/`y`/`z`), si aparece en pareja con otro evento.
2. **Actualizar `docs/event-catalog.md`** con una fila en la sección
   correspondiente. Añadir una entrada al **Registro de cambios** al
   final del archivo con fecha (`2026-MM-DD`). Este cambio va en su
   propio commit con mensaje `catalog: ...`.
3. **Implementar el Listener en `plugin/src/main/java/com/mcecosystem/eventcollector/`**
   siguiendo el template de abajo. Usa `EventJson.base(...)` /
   `EventJson.position(...)` para no duplicar el esqueleto.
4. **Registrar el listener** en `EventCollectorPlugin.java:onEnable()`
   junto a los otros: `getServer().getPluginManager().registerEvents(...)`.
5. **Escribir test MockBukkit** en `plugin/src/test/java/.../<Nombre>ListenerTest.java`
   siguiendo el patrón de los otros tests. Debe cubrir el happy path y
   los edges (jugador null si aplica, cancelación de evento Bukkit,
   valores límite).
6. **Build + tests locales**: `cd plugin && ./gradlew build`. Debe
   pasar todo en verde.
7. **Deploy a staging primero** (nunca a prod directo): copiar el jar
   nuevo a `infra/staging-data/plugins/`, arrancar staging (`start-mc.bat staging`),
   ejercitar la acción real en juego.
8. **Verificar en la DB** con la query de la última sección. Debe
   aparecer el evento con schema correcto (base + data completo).
9. **Deploy a prod**: cuando staging quede verde, `./gradlew build` +
   copia el jar a `<world-dir>/plugins/` + `docker compose ... up -d
   --force-recreate minecraft-prod`. Verifica logs
   (`docker logs mc-ecosystem-minecraft-prod-1 | grep EventCollector`).
10. **Verificación humana en vivo** en prod, tal como se hizo con el
    despliegue inicial de EventCollector (ver runbook "Despliegue
    inicial"). Ejecuta la acción, corre la query, confirma.
11. **Commit del plugin + tests** con mensaje `plugin: añade evento
    <type>`. Y push cuando todo esté verde.

## Convenciones vigentes

- **Nombres**: `dominio.accion` en inglés, minúsculas, separado por
  punto. Un solo punto (no `dominio.sub.accion`). Si necesitas
  jerarquía, usa prefijo (`event.start`/`event.end`, `haunt.appearance`).
- **`v` (versión)**: siempre `1` al nacer. Agregar campos a `data`
  significa subir `v` y documentar ambas versiones en el catálogo.
  Nunca reinterpretar un campo existente ni renombrar un `type` —
  eso es un tipo nuevo.
- **Timestamps**: **UTC**, ISO-8601 (`Instant.now().toString()` en Java).
  Los guarda el plugin al ocurrir el evento; `received_at` lo pone la DB
  al recibirlo.
- **Identidad de jugador**: siempre **UUID**, nunca nombre. El nombre
  vive en la tabla `players` como atributo histórico.
- **Posición (opcional)**: si el evento tiene lugar en el mundo, incluir
  `world`, `x`, `y`, `z` en las columnas de la tabla (no dentro de
  `data`). `EventJson.position(json, loc)` lo hace.
- **`data` (JSONB)**: sólo lo específico del tipo. Sin `player_uuid`
  duplicado ni `ts` duplicado (ya están en columnas). Un objeto plano
  cuando sea posible; anidar sólo cuando aporte.
- **Chat completo** (decisión A del catálogo): `chat.message` guarda
  el `content` completo con consentimiento explícito de los jugadores.
  Otros tipos con texto libre siguen esta línea.
- **Sin PII cruda**: la IP se hashea antes de emitirse (ver
  `session.start.data.ip_hash`), nunca en claro.
- **Idempotencia**: cada evento lleva un `event_uuid` random (v4)
  generado por el plugin. La API rechaza duplicados con HTTP 409, el
  plugin re-manda desde su buffer local si la red falló y no sabe si
  el POST llegó — el UUID cerrado evita doble inserción.
- **Append-only**: la tabla `events` en la DB revoca UPDATE/DELETE al
  rol `mc_app`. Si un evento fue mal emitido, se corrige con un evento
  nuevo (compensatorio), jamás con un update.

## Template Java minimalista

Plantilla para un listener nuevo. Se apoya en `EventJson.base(...)`
para el esqueleto común y `EventJson.position(...)` si el evento tiene
localización espacial. Adapta el `@EventHandler` al evento Bukkit del
que quieras derivar.

```java
package com.mcecosystem.eventcollector;

import com.google.gson.JsonObject;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
// Import el evento Bukkit concreto que te interesa, p.ej.:
// import org.bukkit.event.player.PlayerXxxEvent;

/**
 * <type> v1 según docs/event-catalog.md:
 * data = { ... campos específicos ... }
 */
public final class <Nombre>Listener implements Listener {

    private final EventSender sender;

    public <Nombre>Listener(EventSender sender) {
        this.sender = sender;
    }

    @EventHandler(ignoreCancelled = true)
    public void on<Evento>(<EventoBukkit> event) {
        Player player = event.getPlayer(); // ajusta según el evento
        // Toda lectura de la API de Bukkit ocurre AQUÍ, en el hilo
        // principal. Al hilo de red sólo viaja el String JSON final.

        JsonObject data = new JsonObject();
        data.addProperty("campo1", /* ... */);
        // ...

        JsonObject json = EventJson.base("<type>", player.getUniqueId());
        EventJson.position(json, player.getLocation()); // si aplica
        json.add("data", data);

        sender.send(EventJson.eventUuid(json), json.toString());
    }
}
```

Notas:

- `EventJson.base(type, playerUuid)` mete `event_uuid`, `type`, `v=1`,
  `ts` y (si no es null) `player_uuid`. Para eventos de servidor
  pasa `null` como uuid.
- `EventJson.position(json, loc)` añade `world`/`x`/`y`/`z` a las
  columnas top-level, NO dentro de `data`.
- `EventJson.eventUuid(json)` extrae el uuid ya generado — evita
  generarlo dos veces.
- `sender.send(...)` es **fire-and-forget**: no bloquea, si la API está
  caída el evento va al buffer SQLite local y se reintenta.

## Ejemplo end-to-end: `tp.request` + `tp.completed`

*Solo documentación — no implementado.* Ilustra el patrón de par de
eventos con estado en memoria y timeout.

**Motivación**: capturar los `/tpa` entre jugadores para poder
analizar patrones de visita, distancias promedio, y detectar abuso
(muchos pedidos rechazados a un mismo target).

**Entradas al catálogo** (`docs/event-catalog.md`, sección "Social"
por ejemplo):

| type | data | Notas |
|---|---|---|
| `tp.request` | `{ "target_uuid": uuid, "distance": int? }` | Se emite cuando un jugador ejecuta `/tpa <target>`. `player_uuid` = quien pide. `distance` en bloques si están en el mismo mundo, `null` cross-dimension. pos = donde está el que pide |
| `tp.completed` | `{ "target_uuid": uuid, "duration_s": int, "accepted": bool }` | Se emite cuando se resuelve la request (accept / deny / timeout). `player_uuid` = quien pidió. `accepted=false` = deny o timeout. `duration_s` desde el `tp.request` correspondiente. pos = donde estaba el que pidió al resolverse |

**Registro de cambios del catálogo**:

```
- **2026-MM-DD** · Nuevos tipos `tp.request` y `tp.completed`
  (comandos de teletransporte, v1). Par de eventos: `tp.request` al
  ejecutar `/tpa`, `tp.completed` al resolverse. `accepted=false`
  cubre deny y timeout (indistinguibles hoy; considerar reason en v2
  si se necesita).
```

**Skeleton del listener** (siguiendo el template):

```java
public final class TeleportListener implements Listener {

    private final EventSender sender;
    // Estado en memoria para calcular duration_s cuando llegue completed.
    // Key: requester UUID; value: instante del request. Volatil por diseño:
    // si el server se reinicia con un tp.request pendiente, se pierde
    // (aceptado — es un evento efímero de UX).
    private final Map<UUID, Instant> pending = new ConcurrentHashMap<>();

    public TeleportListener(EventSender sender) {
        this.sender = sender;
    }

    // Al ejecutar /tpa:
    @EventHandler(ignoreCancelled = true)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        // Detectar el comando y extraer target. Emitir tp.request.
        // pending.put(player.getUniqueId(), Instant.now());
        //
        // JsonObject data = new JsonObject();
        // data.addProperty("target_uuid", target.getUniqueId().toString());
        // data.addProperty("distance", sameWorld ? distance : null);
        //
        // JsonObject json = EventJson.base("tp.request", player.getUniqueId());
        // EventJson.position(json, player.getLocation());
        // json.add("data", data);
        // sender.send(EventJson.eventUuid(json), json.toString());
    }

    // Al aceptar/denegar/timeout: emitir tp.completed usando el
    // pending.get(requester) para calcular duration_s.
}
```

**Registro en `EventCollectorPlugin.java:onEnable()`**:

```java
getServer().getPluginManager().registerEvents(new TeleportListener(eventSender), this);
```

**Nada que tocar en la API** (`api/src/routes/events.ts`): el schema
Fastify es permisivo con `type` (cualquier string ≥1 char). Un tipo
nuevo del plugin llega y se guarda sin cambios de servidor. La única
validación adicional que la API hace por tipo la maríamos a mano si un
tipo lo justifica (no es el caso hoy).

**Test MockBukkit** (`plugin/src/test/java/.../TeleportListenerTest.java`)
mínimo: simular `/tpa`, capturar el JSON enviado, aserciones sobre
`type`, `data.target_uuid`, `data.distance`, `player_uuid`.

## Query SQL para verificar

Tras deploy y ejecutar la acción real en juego, correr esta query
para confirmar que el evento cuadra con el catálogo:

```sql
-- Reemplazar '<type>' por el tipo nuevo (p.ej. 'tp.request').
SELECT
  ts,
  type,
  v,
  player_uuid,
  world, x, y, z,
  data,
  received_at - ts AS latencia_llegada
FROM events
WHERE type = '<type>'
  AND ts >= '2026-MM-DD 00:00:00+00'  -- desde el deploy
ORDER BY ts DESC
LIMIT 20;
```

Comprobaciones a ojo sobre el resultado:

- **`type`** exacto (typo aquí = evento huérfano imposible de agrupar).
- **`v = 1`** (o el que corresponda si es evolución).
- **`ts`** en UTC (columna llega ya con `+00`).
- **`player_uuid`** es UUID válido si aplica (NULL para eventos de servidor).
- **`world`/`x`/`y`/`z`** poblados si el evento tiene posición.
- **`data`** trae exactamente los campos que dice el catálogo, ni uno
  más ni uno menos. `additionalProperties: false` está sólo en base,
  no en `data`, así que campos extra pasan silenciosamente — la
  disciplina la pone esta revisión humana.
- **`latencia_llegada`** típicamente <100 ms local, <500 ms bajo
  carga. Si es mucho más alto, el buffer del plugin está reintentando
  (mira los logs del plugin: `docker logs mc-ecosystem-minecraft-prod-1 | grep buffer`).

Comparación cruzada útil para pares como `tp.request`/`tp.completed`:

```sql
-- Requests que nunca se completaron (timeout no capturado, bug, etc.).
SELECT r.ts, r.player_uuid, r.data->>'target_uuid' AS target
FROM events r
LEFT JOIN events c ON c.type = 'tp.completed'
  AND c.player_uuid = r.player_uuid
  AND c.ts BETWEEN r.ts AND r.ts + INTERVAL '5 minutes'
WHERE r.type = 'tp.request'
  AND c.id IS NULL
ORDER BY r.ts DESC;
```

Si aparecen "requests huérfanas" recurrentes, el evento `tp.completed`
no cubre todos los caminos — revisar el listener.

## Handler del bot Pulso (opcional)

Añadir el evento al catálogo no obliga a que Pulso lo anuncie en
Discord. Los que sí se anuncian tienen un `EventHandler` en
`bot/src/handlers/` registrado en `bootstrap/compose.ts`. Antes de
escribir uno nuevo, decidir de qué **tipo** es el handler:

- **Historia**: describe un hecho pasado fechado. El mensaje sigue
  siendo cierto aunque llegue tarde (ej. "X consiguió Y"). No
  necesita validar frescura.
- **Estado**: anuncia una transición como si ocurriera ahora (ej.
  "X se ha unido", "Servidor iniciado"). **Requiere validar
  frescura antes de publicar** — importar `isFreshEvent` de
  `bot/src/handlers/freshness.ts` y consumir `context.logger` +
  `context.freshnessThresholdMs`. Ver la sección "Handlers de
  estado vs handlers históricos" en `docs/pulso-bot-design.md`
  para el contrato completo (BUG-02A / BUG-02B).

Regla rápida: si el evento puede llegar tarde por el `storeDurable`
del plugin **y** su mensaje afirma algo sobre el presente, es de
estado.

## Referencias

- `docs/event-catalog.md` — catálogo canónico. Fuente de verdad.
- `docs/pulso-bot-design.md` — "Handlers de estado vs handlers
  históricos" (contrato de freshness).
- `docs/runbook.md` — sección "Despliegue inicial de EventCollector en
  prod" para el patrón end-to-end de deploy + verificación humana.
- `plugin/src/main/java/com/mcecosystem/eventcollector/` — listeners
  existentes (`BlockBreakListener` es el más simple, buen punto de
  partida como inspiración).
- `plugin/src/test/java/com/mcecosystem/eventcollector/` — tests
  MockBukkit correspondientes.
- ADR-007 — cutoff oficial de captura. Cualquier evento nuevo aporta
  a la historia del mundo real desde su primer `ts` post-`2026-07-26
  23:25:52 UTC`.
