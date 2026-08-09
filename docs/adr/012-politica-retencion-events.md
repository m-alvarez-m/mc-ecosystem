# ADR-012: Política de retención de la tabla `events`

- **Fecha**: 2026-08-08
- **Estado**: aceptado
- **Fase del roadmap**: FASE A.2 · P1-6 (`docs/roadmap-consolidacion-v1.2-v2.0.md`)

## Contexto

La tabla `events` es el corazón de la telemetría del ecosistema
(consumida por `bot`, `api`, futuras vistas de Insight y por el flujo
Genesis). Empezó a recibir escrituras el **2026-07-26** con el
despliegue efectivo del plugin `EventCollector` (ver ADR-007) y desde
entonces crece de forma monótona sin ningún mecanismo de purga,
archivado o rotación.

El patrón de escritura combina eventos de alta frecuencia
(`block.place`, `block.break`, `player.move`, `chat.message`,
`session.start/end`) con eventos de baja frecuencia y alto valor
narrativo (`player.first_join`, `player.death`, `player.kill`,
`boss.kill`, `milestone.first`, `achievement.unlock`, `server.start`,
`server.stop`). A pocas semanas de operación el volumen aún es
manejable, pero la trayectoria es clara: sin política, la tabla
degradará queries del bot/API (índices más grandes que RAM, planners
cambiando a seq scan) y terminará saturando el volumen `pg-data` sin
aviso.

Además, el consumo por cursor definido en ADR-010 asume que los
eventos permanecen accesibles por su `id` monotónico creciente —
cualquier política que rompa esa continuidad debe planificarse para
no romper a los consumidores que ya dependen de ella.

## Problema

Se necesita una política que:

1. Acote el crecimiento de `events` de forma predecible.
2. Preserve la historia narrativa del servidor (los eventos que un
   jugador va a querer poder consultar años después).
3. No destruya datos que puedan ser reclamados legítimamente en el
   futuro por trabajos de analítica, forense o restauración.
4. Se ejecute de forma automática y verificable, sin depender de
   que un humano recuerde correrla cada mes.
5. Herede la disciplina de ADR-011: nada se da por hecho hasta que
   un comando confirme el estado real del artefacto.

## Decisión

### D1 · Retención por **tiempo** (ventana rodante de 24 meses)

Se conservan en `events` (base caliente) todas las filas con
`created_at >= NOW() - INTERVAL '24 months'`. Todo lo anterior es
candidato a archivado + purga (con excepciones definidas en D4).

Justificación: el servidor tiene una escala de decenas de jugadores;
la tasa esperada (~10⁴ eventos/día) da un techo estimado de ~7 M
filas en la ventana de 24 meses, manejable por PostgreSQL con los
índices actuales. La retención por tiempo es además la política más
comunicable ("tu historia de los últimos 2 años sigue viva").

**Cláusula de revisión**: si la tasa media de escritura crece más
de **3×** respecto de la línea base establecida en 2026-07 → 2026-12
(a medir sobre `count(*)` mensual), este ADR queda invalidado y se
abre un ADR-013 para revisar el criterio (posible cambio a política
híbrida tiempo+volumen).

### D2 · Destino: **export a Backblaze B2 + purga**, con verificación previa

Antes de borrar nada de PostgreSQL, los eventos vencidos se exportan
como archivo mensual comprimido:

```
archive/events/events-YYYY-MM.jsonl.gz
```

en el bucket B2 ya utilizado por el servicio `backup` (mismas
credenciales, misma configuración de retención del bucket).
Formato: **JSONL** (una fila JSON por línea, todas las columnas
serializadas) comprimido con gzip. Este formato es trivial de leer
por cualquier consumidor futuro y no depende de la versión de
PostgreSQL en la que fue generado.

**Regla dura de checkpoint (aplicación literal de ADR-011)**:

> Ninguna fila de `events` se borra de PostgreSQL hasta que el
> archivo mensual correspondiente exista en B2 **y** su checksum
> SHA-256 remoto coincida con el checksum del archivo local recién
> subido.

Secuencia obligatoria:

1. `SELECT` de las filas del mes objetivo → serializar a JSONL
   local → gzip.
2. Calcular `sha256sum` local.
3. Subir a B2 con el mismo nombre.
4. Descargar el `sha256sum` (o el objeto y recalcular) desde B2.
5. **Sólo si** coinciden: emitir el `DELETE` sobre `events` en la
   misma transacción que se registra el archivo como completado en
   una tabla `events_archive_log` (ver más abajo).

Si cualquiera de los pasos 2-4 falla o los checksums no coinciden,
el `DELETE` no se ejecuta y el intento se registra como fallido en
`events_archive_log`. El cron vuelve a intentarlo en el siguiente
ciclo. Es preferible que la tabla crezca un mes extra a perder
eventos.

Se crea una tabla auxiliar de auditoría:

```
events_archive_log (
  id            SERIAL PRIMARY KEY,
  period        TEXT NOT NULL,           -- 'YYYY-MM'
  b2_object_key TEXT NOT NULL,
  sha256_local  TEXT NOT NULL,
  sha256_remote TEXT NOT NULL,
  row_count     BIGINT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  archived_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  purged_at     TIMESTAMPTZ,             -- NULL = subido pero no purgado
  status        TEXT NOT NULL            -- 'ok' | 'checksum_mismatch' | 'upload_failed'
);
```

Esta tabla es pequeña, inmortal, y responde en un solo `SELECT` a
la pregunta "¿qué meses viven fuera de la base caliente y dónde?".

### D3 · Mecanismo: **cron automático + endpoint on-demand**

**Cron** — ejecutado dentro del contenedor `api` (donde ya vive el
acceso a Postgres y las credenciales de B2 se pueden montar de forma
consistente con el resto de servicios). Cadencia: **mensual, día 1
a las 04:00 UTC** (madrugada local, mínimo tráfico). Procesa todos
los meses vencidos que aún no tengan una fila `status='ok'` en
`events_archive_log`.

**Endpoint** — `POST /admin/events/prune`:

- **Autenticación**: header `X-Admin-Token` con un token compartido
  cargado desde variable de entorno `ADMIN_PRUNE_TOKEN` (nunca
  hardcoded, nunca en git). El token se genera con `openssl rand
  -hex 32` y se guarda en `infra/.env` (que ya está fuera del
  repo).
- **Superficie de red**: el endpoint sólo se sirve por la red
  interna de Docker Compose. **No** se expone vía `cloudflared`
  ni `playit`. Se documenta en el runbook cómo invocarlo desde
  otro contenedor de la misma red (típicamente `docker exec` sobre
  `api` mismo con `curl localhost`).
- **Payload opcional**: `{"period": "YYYY-MM"}` para forzar un mes
  concreto; sin payload, comportamiento idéntico al cron.
- **Respuesta**: JSON con `{status, period, rows_archived,
  rows_deleted, b2_key, sha256}`.

Justificación: el cron cubre el 99 % de los casos; el endpoint es
la escotilla de escape para tests, ejecuciones manuales tras un
incidente, y recuperación si un mes se salta.

### D4 · Excepciones perpetuas (nunca archivar, nunca purgar)

Los siguientes `event_type` **jamás** entran en el flujo de
archivado. Permanecen en `events` indefinidamente:

- `player.first_join` — momento fundacional del jugador.
- `player.death` — valor narrativo alto ("cómo moriste hace 5 años").
- `player.kill` — historia de rivalidades PvP.
- `boss.kill` — hitos de peleas grandes.
- `milestone.first` — primeros de todo por jugador (primer diamante,
  primer nether, etc.).
- `achievement.unlock` — logros mostrados en perfiles.
- `server.start` — trazabilidad forense (auditoría de arranques).
- `server.stop` — trazabilidad forense (auditoría de paradas).

La condición SQL efectiva del cron es:

```sql
WHERE created_at < NOW() - INTERVAL '24 months'
  AND event_type NOT IN (
    'player.first_join', 'player.death', 'player.kill',
    'boss.kill', 'milestone.first', 'achievement.unlock',
    'server.start', 'server.stop'
  )
```

**Nota explícita**: `session.start`, `session.end` y `chat.message`
**sí** se archivan y purgan con el resto. Su valor narrativo
individual es bajo; su valor agregado (métricas de tiempo jugado,
volumen de conversación) puede reconstruirse desde B2 cuando se
necesite.

La lista de excepciones vive en un único punto del código
(constante `PERPETUAL_EVENT_TYPES`) para poder auditarse y evolucionar
sin cazar strings sueltos.

### D5 · Activación con **DRY_RUN=true** desde el primer día

El cron y el endpoint se despliegan **desde ahora**, no cuando el
primer batch real esté por vencer (2028-07). Durante toda la
ventana previa a la primera purga real, corren con
`EVENTS_PRUNE_DRY_RUN=true`.

Comportamiento en modo dry-run:

- **Sí** ejecuta el `SELECT` de identificación de filas candidatas.
- **Sí** genera el JSONL local y calcula su `sha256sum`.
- **Sí** loguea todo el plan que ejecutaría: `period`, `row_count`,
  `size_bytes`, `sha256_local`.
- **No** sube nada a B2.
- **No** ejecuta ningún `DELETE`.
- **No** escribe en `events_archive_log`.

Justificación (crítica): el código de archivado va a dormir ~2 años
antes de su primera invocación real. Sin ejercitación mensual, el
bit-rot es garantía (cambios en el driver de Postgres, en la SDK de
B2, en la versión de Node, en el esquema de `events` mismo, en la
estructura del bucket). El dry-run mensual **prueba en vivo** todo
el camino excepto los dos side effects reales (upload y delete).
Cuando se acerque el primer archivado real, apagar `DRY_RUN` es un
cambio de un solo bool con altísima confianza.

Adicionalmente: incluso en dry-run, se cubrirá con un test de
integración que fuerza `NOW() - INTERVAL '24 months'` con datos
sintéticos y verifica el flujo completo (upload → checksum →
delete) contra un bucket B2 de pruebas o un mock local.

### Verificación de runtime (ADR-011)

Al terminar la implementación de este ADR, la sesión debe cerrar
con evidencia estilo:

```
Runtime verification:
  docker exec mc-ecosystem-api-1 sh -c 'grep -c PERPETUAL_EVENT_TYPES /app/dist/…/prune.js'
    → 1 (fix presente en runtime)
  docker exec mc-ecosystem-api-1 sh -c 'crontab -l | grep events/prune'
    → línea presente (cron registrado)
  docker exec mc-ecosystem-api-1 printenv EVENTS_PRUNE_DRY_RUN
    → true (activación segura por defecto)
```

## Consecuencias positivas

- `events` deja de crecer sin techo; el tamaño de la base caliente
  queda acotado a una ventana rodante predecible.
- La historia narrativa del servidor (deaths, kills, boss fights,
  achievements, primeros hitos) se preserva íntegra en la base
  caliente para consulta instantánea por parte del bot y del futuro
  Insight.
- Los eventos archivados no se pierden: viven en B2 con la misma
  garantía de durabilidad que los backups regulares.
- La política es auditable en un solo `SELECT * FROM
  events_archive_log`.
- La activación en dry-run previene el bit-rot típico de código que
  duerme meses.
- La verificación previa a la purga (D2) elimina la clase de
  incidentes en los que un archivado "supuestamente exitoso" se
  descubre corrupto meses después, cuando ya se borró el original.

## Consecuencias negativas

- Dependencia adicional en B2 para cualquier restauración futura
  de eventos archivados. Mitigado por: B2 ya es un componente
  crítico del stack (backups); si B2 cae, hay problemas mayores
  que el archivado.
- El endpoint `POST /admin/events/prune` es una superficie nueva
  con capacidad destructiva. Mitigado por: red interna únicamente,
  header con token de 256 bits, y `DRY_RUN=true` como default
  operativo durante los primeros ~24 meses.
- Un mes que se salte (fallo de upload, checksum mismatch,
  B2 down) requiere que el cron se ejecute de nuevo el mes
  siguiente o que un humano invoque el endpoint. La tabla
  `events_archive_log` hace visible qué meses están pendientes.

## Alternativas descartadas

- **Purga total (DELETE sin archivo)**: descartada. Pérdida
  irrecuperable de datos que en el futuro pueden tener valor
  analítico o forense no anticipado hoy.
- **Archivado a tabla `events_archive` dentro de la misma DB**:
  descartada. Sólo pospone el problema — el volumen `pg-data`
  sigue creciendo. Además convierte a Postgres en un almacén de
  histórico frío, que no es su rol.
- **Retención por volumen (ej. tope duro de 5 M filas)**: descartada
  como criterio primario. Genera ventanas temporales impredecibles
  y comunicación confusa hacia los jugadores. Reservada como
  posible componente de una política híbrida en el ADR-013
  hipotético si D1-cláusula-de-revisión se activa.
- **Activación diferida (implementar código en 2028-06, un mes
  antes del primer vencimiento)**: descartada. Máximo riesgo de
  bit-rot y máxima presión temporal para debuggear si algo falla
  en el primer intento real.

## Referencias cruzadas

- **ADR-007** — Cutoff oficial de captura del mundo real
  (2026-07-24 → 2026-07-26): fija el origen temporal desde el que
  cuenta la ventana rodante de 24 meses.
- **ADR-010** — Consumo del event store por cursor `id`: los
  consumidores existentes se apoyan en `id` monotónico; el
  archivado no reasigna ni compacta ids, sólo elimina filas
  antiguas, preservando la semántica del cursor.
- **ADR-011** — Runtime siempre debe coincidir con el código
  fuente: aplicado literalmente en D2 (verificación B2 antes de
  purgar) y en la sección "Verificación de runtime" de este ADR.
- **`docs/roadmap-consolidacion-v1.2-v2.0.md`** — FASE A.2 · P1-6.
- Servicio `backup` en `infra/docker-compose.prod.yml` — fuente
  de las credenciales y patrón de acceso a B2 que se reutilizará
  aquí.
