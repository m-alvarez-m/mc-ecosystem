# ADR-011: Runtime siempre debe coincidir con el código fuente

- **Fecha**: 2026-08-03
- **Estado**: aceptado

## Contexto

El bug BUG-02 (Discord publicaba "Servidor iniciado" seguido de
"Servidor detenido" mientras Minecraft seguía online) tuvo **tres
intentos consecutivos** de corrección — 02A, 02B, 02C — porque los
fixes de código no se traducían en fixes de runtime:

- **BUG-02A** (auditoría) — identificó la causa aparente: el plugin
  reentregaba `server.stop` viejos desde su buffer SQLite al arrancar.
- **BUG-02B** (freshness contract) — añadió `isFreshEvent()` a los
  handlers de estado. El código mergeó, los 1108 tests quedaron
  verdes, la fase se declaró cerrada.
- **BUG-02C** (auditoría del bug persistente) — el bug volvió a
  aparecer en producción. La inspección con
  `docker image inspect mc-ecosystem-bot --format '{{.Created}}'`
  reveló que la imagen del contenedor era del **2026-08-01 06:46
  UTC**, previa al commit de 02B (`5590cb8`, 2026-08-02).
  `docker run --rm mc-ecosystem-bot ls /app/dist/handlers` confirmó
  que `freshness.js` **no existía en la imagen**. El fix estaba en
  git; el runtime jamás lo ejecutó.

Este patrón no fue nuevo. **ADR-007** documentó exactamente la misma
clase de fallo tres semanas antes: el nacimiento del mundo real
(v1.0, 2026-07-24) ocurrió sin `EventCollector` desplegado porque el
volumen prod no incluía el `.jar` reciente. **~63 h de gameplay
histórico sin telemetría** — pérdida cero práctica sólo por suerte
(no hubo actividad real en ese intervalo).

Dos ocurrencias del mismo defecto en dos capas distintas (Java plugin
sobre volumen persistente y Node.js/TS bot sobre imagen Docker) es
señal de un problema institucional, no de un error puntual.

## Problema

El código fuente de un repositorio no es autoritativo por sí solo.
Sólo el **artefacto en runtime** determina el comportamiento
observado. Sin una disciplina explícita para cerrar la brecha entre
"código mergeado" y "artefacto ejecutándose", ambos pueden
desviarse indefinidamente:

- Una imagen Docker puede quedar cacheada localmente y `docker
  compose up -d` (sin `--build`) reusarla en lugar de reconstruir.
- Un `.jar` de plugin puede quedar en un directorio de deploy sin
  que ningún proceso lo copie automáticamente desde el output de
  build.
- Un volumen persistente puede contener una versión anterior de
  configuración/binarios que sobrevive a `docker compose down`.

Estos modos de fallo son silenciosos: los tests pasan, `git status`
está limpio, los healthchecks del contenedor devuelven verde, y sin
embargo la ejecución diverge del código.

## Decisión

**Ningún fix de código se considera resuelto hasta que un comando
lea del artefacto en runtime y confirme que ejecuta el output del
último commit.**

La verificación debe:

1. Ser un comando concreto y reproducible (no "revisar los logs").
2. Ejecutarse SOBRE el artefacto vivo, no sobre el código fuente ni
   sobre el output de `npm run build` en el host.
3. Buscar un marcador específico del fix (símbolo, archivo, versión
   compilada) — no un heurístico como "arranca sin errores".

**Comandos por tipo de artefacto**:

| Tipo | Comando de verificación |
|---|---|
| Servicio TS/Node en Docker (bot, api, worker) | `docker exec <container> sh -c 'grep -c <simbolo-del-fix> /app/dist/<ruta>'` — debe ser ≥1. Complementar con `docker inspect <container> --format '{{.Image}}'` para confirmar que la imagen corresponde al último `docker build`. |
| SPA en Docker con nginx (genesis, dashboards) | Servir + navegar + `curl` al bundle: `curl -s http://…/assets/<hash>.js \| grep -c '<simbolo>'`. El hash de Vite cambia cuando cambia el código; hash idéntico = build stale. |
| Plugin Java en Minecraft server | `docker exec <server> ls /data/plugins/` (fecha del `.jar`) + comando RCON `plugins` o `version <PluginName>` para leer la versión que el server realmente cargó. |
| Config estática montada por bind mount | `docker exec <container> md5sum /path/to/config` y compararla contra `md5sum` del archivo fuente en el host. |

## Aplicación al proyecto

- **`start-mc.bat`** ya reconstruye la imagen del servicio bajo
  iteración activa (hoy `bot`; mañana workers de Insight, backend
  del dashboard, o cualquier servicio nuevo que se añada al
  compose). Este cambio se aplicó en el commit
  `f302151` como parte del fix definitivo de BUG-02C. **Este ADR
  NO modifica `start-mc.bat`** — sólo captura la regla que dicta
  por qué el `--build` debe estar ahí.

- Servicios estables (`postgres`, `minecraft-prod`, `packserver`,
  `cloudflared`, `playit`) NO requieren rebuild en cada arranque —
  usan imágenes upstream inmutables o volúmenes de datos. Sólo los
  servicios cuyo código vive en el repo y evoluciona (`api`, `bot`,
  futuros workers y frontends) heredan la regla del `--build`.

- Al **terminar** un fix, la sesión debe cerrar con una línea de
  evidencia estilo:

  ```
  Runtime verification:
    docker exec mc-ecosystem-bot-1 grep -c isFreshEvent \
      /app/dist/handlers/server-stopped-handler.js
    → 1 (fix presente en runtime; imagen creada 2026-08-03T06:22:11Z)
  ```

  Esta línea debe aparecer en el mensaje de commit o en el reporte
  final. Su ausencia es el olor que delata un fix "cerrado" que en
  realidad nunca corrió.

## Consecuencias positivas

- La brecha código-runtime deja de ser silenciosa. Cualquier
  regresión del mismo tipo será atrapada por la verificación
  explícita antes de cerrar el ticket, no días después por un
  reporte del usuario.
- Auditorías futuras del tipo de BUG-02C (donde se sospecha que un
  fix "ya aplicado" no está aplicado) tienen un comando canónico
  para responder la pregunta en segundos.
- Nuevos servicios que se agreguen al monorepo heredan el patrón
  por defecto — el runbook y el launcher los cubren sin necesidad
  de re-descubrir la lección.

## Consecuencias negativas

- El `docker compose up -d --build` en `start-mc.bat` añade tiempo
  de rebuild por cada arranque para el servicio activo (típicamente
  10-30 s para el bot; layer caching de Docker mitiga el peor caso).
  Se acepta como precio de la garantía.
- Añade una acción explícita al final de cada fix ("verifica el
  runtime"). Hay una tentación real de saltarla cuando todo se ve
  verde. La disciplina se sostiene poniendo la evidencia en el
  commit message, no en la memoria de quien cerró la sesión.

## Consecuencias para el runbook

Se añade a `docs/runbook.md` una nueva sección **"Verificación de
runtime tras un fix"** con los comandos exactos por tipo de servicio
(tabla del apartado *Decisión* de este ADR). La sección referencia
este ADR como fuente autoritativa de la regla.

## Alternativas descartadas

- **CI que rebuild + deploy automáticamente en cada push a `main`**:
  ideal a largo plazo, hoy fuera de alcance (el proyecto no tiene
  pipeline). La regla manual del `--build` cubre el 100 % del riesgo
  con coste operacional trivial mientras no exista CI.
- **Reforzar sólo el `--build` sin regla institucional escrita**:
  suficiente para prevenir la próxima ocurrencia en el bot pero no
  se generaliza. La regla escrita se aplica cuando el proyecto añada
  el 8º, 9º, 10º servicio con código vivo.
- **Convertir a los servicios activos en "immutable tags"
  versionados (`mc-ecosystem-bot:1.2.3`)**: aporta trazabilidad
  pero requiere versionar cada iteración de dev, lo cual choca con
  la velocidad de los tickets D-fases y el flujo actual de
  commits pequeños. Reservado para cuando exista un contrato de
  release público.

## Referencias cruzadas

- **ADR-007** — Cutoff oficial de captura del mundo real: mismo
  patrón detectado antes en el plugin `EventCollector` (jar no
  desplegado durante 3 días).
- **BUG-02A / 02B / 02C** — causa raíz de despliegue confundida
  como bug de código durante 2 iteraciones antes de que la
  auditoría de 02C aislase la brecha código-runtime.
- Commit `f302151` (2026-08-03) — aplicación operacional en
  `start-mc.bat`.
- `docs/runbook.md` — sección "Verificación de runtime tras un fix"
  (a añadir por separado como consecuencia editorial de este ADR).
