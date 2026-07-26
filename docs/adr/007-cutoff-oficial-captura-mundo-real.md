# ADR-007: Cutoff oficial de captura del mundo real

- **Fecha**: 2026-07-26
- **Estado**: aceptado

## Contexto

El plugin `EventCollector` es quien captura toda la telemetría de
gameplay del servidor: `session.start`/`session.end`/`session.afk_*`,
`block.break`/`block.place`, `position.sample`, `chat.message`,
`damage.minute`, `mob.kill`, `player.death`, `advancement.done`,
`server.start`/`server.stop`/`server.tps_sample`, etc. (ver
`docs/event-catalog.md` para el catálogo completo). Sin este plugin
cargado, el servidor funciona pero **no se emite un solo evento de
jugador** — la tabla `events` sólo recibe lo que emita la infra
(`backup.done` desde el script `backup.sh`).

El nacimiento del mundo real (v1.0, 2026-07-24, ADR-006) **NO desplegó
EventCollector**: la carpeta `plugins/` del mount limpio venía sin el
jar y el checklist de nacimiento entonces vigente no tenía un item para
copiarlo. Consecuencia observable a los 3 días: la tabla `events` no
tenía **ni un solo evento del plugin generado por el mundo real**
entre el arranque bueno de prod (`2026-07-24 08:17 UTC`, ADR-006) y el
2026-07-26. Los únicos eventos post-nacimiento eran `backup.done` del
script y algún `server.*` residual de la sesión de diagnóstico
temprana del 2026-07-24.

El 2026-07-26 se desplegó EventCollector en prod (compilar + copiar
jar + config versionado + force-recreate); ver runbook
"Despliegue inicial de EventCollector en prod". Desde ese arranque el
plugin emite normalmente.

Este ADR fija la **fecha oficial** que Insight, cualquier análisis
posterior, cualquier ranking o narrativa del mundo real debe usar como
"inicio de la historia registrada".

## Decisión

El **cutoff oficial de captura del mundo real es**:

**`2026-07-26 23:25:52.787196+00 UTC`** (17:25:52 local Mexico UTC-6).

Corresponde al primer `server.start` en `events` cuyo `data.plugins`
incluye `EventCollector 0.1.0`. Antes de ese instante, la tabla
`events` **no representa el mundo real**:

- Eventos con `ts < 2026-07-24 00:00 UTC`: pertenecen a la fase
  staging (mismo esquema, mismo esquema de player_uuid; distinto mundo,
  distinto contexto operativo). Útiles para debugging del pipeline,
  no para narrativa del mundo real.
- Eventos con `2026-07-24 00:00 UTC ≤ ts < 2026-07-26 23:25:52 UTC`:
  coletazos administrativos (cierres de sesión staging, cierres de
  torneo, `backup.done` del script) y arranques del propio contenedor
  prod sin plugin. No cuentan como narrativa.

## Consecuencias

- **Insight y futuros workers analíticos**: al calcular estadísticas,
  rankings, "primera vez que...", récords o crónicas del mundo real,
  filtrar `WHERE ts >= '2026-07-26 23:25:52.787196+00'`. Cualquier
  hecho anterior en la tabla NO es del mundo real.
- **Pérdida aceptada**: ~63 h entre nacimiento y captura
  (`2026-07-24 08:17 UTC → 2026-07-26 23:25:52 UTC`). Pérdida
  **práctica cero**: no hubo sesiones de gameplay real en la ventana
  (sólo arranques + verificaciones + drills del asistente y el dueño).
  Pérdida **conceptual**: si algún jugador hubiese hecho algo entre
  esas fechas, no existe telemetría para probarlo. Se acepta.
- **Nombre honesto**: si alguien futuramente lee crónicas, rankings
  o "primeras veces" y ve el 2026-07-26 como fecha inicial en vez del
  2026-07-24 (nacimiento nominal), sabrá **por qué** consultando este
  ADR — no fue un olvido de crónica sino una limitación real del
  pipeline.
- **Preventivo estructural**: item 7 del checklist de nacimiento
  (runbook) obliga a copiar el jar de EventCollector antes del primer
  arranque de cualquier mundo futuro. Si en algún momento el plugin
  se publica en Modrinth o SpigotMC, migrarlo al `PLUGINS` env del
  compose y retirar el paso manual (dejaría este ADR como registro
  histórico de por qué se aprendió por las malas).

## Verificación

Query que confirma la fecha (ejecutada el 2026-07-26 tras el
despliegue):

```sql
SELECT ts, data FROM events
WHERE type='server.start' AND ts > '2026-07-26 20:00:00'
ORDER BY ts ASC LIMIT 1;
```

Resultado:

```
              ts               |     data (extracto)
-------------------------------+------------------------------------------
 2026-07-26 23:25:52.787196+00 | {"plugins":[{"name":"EventCollector",
                               |   "version":"0.1.0"}, ...],
                               |  "mc_version":"26.1.2"}
```

Verificación end-to-end el mismo día por el dueño: sesión de 34 s
capturó `session.start`, `position.sample`, 5× `block.place`,
5× `block.break`, `chat.message` con contenido, `session.end` con
`duration_s: 34`. Todo con UUID `71804e99-f2aa-32dc-bfcb-0ea5cfdda708`,
IP hasheada, coords coherentes. Log del plugin al arrancar:
`EventCollector activo. Endpoint: http://api:3000/events | umbral AFK:
300s | muestreo posicion: 60s`.
