# ADR-010: Consumo del Event Store mediante polling con cursor por `id`

- **Fecha**: 2026-07-26
- **Estado**: aceptado

## Contexto

Los consumidores del Event Store necesitan descubrir eventos nuevos
para reaccionar a ellos (postear en Discord, alimentar analítica,
generar crónicas, etc.). El schema de `events` (catálogo v1) ya
define una columna `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY
KEY` y una columna `ts TIMESTAMPTZ` puesta por el productor. La
tabla es append-only con `UPDATE`/`DELETE` revocados al rol
aplicación.

ADR-009 fija que los consumidores acceden a datos únicamente vía HTTP
contra la api. Queda por definir **el mecanismo de descubrimiento**
sobre esa capa.

## Problema

Elegir cómo un consumidor sabe qué eventos son "nuevos" para él, con
tres restricciones:

- Debe funcionar bajo desviaciones de reloj entre productor, base de
  datos y consumidor.
- Debe ser determinista: reprocesar debe producir el mismo resultado.
- Debe permitir que cualquier consumidor futuro se enchufe sin
  coordinar con los existentes.

## Decisión

Los consumidores descubren eventos nuevos mediante **polling HTTP
periódico** contra la api, usando la columna `id` de `events` como
**cursor**. La api expone un endpoint genérico de lectura del Event
Store que acepta al menos:

- `after_id` — cursor exclusivo (`id > after_id`)
- `limit` — cota superior de eventos devueltos por respuesta
- `types` — filtro opcional por tipo(s) del catálogo

Los eventos se devuelven ordenados ascendentemente por `id`. Cada
consumidor persiste su `last_processed_id` de forma **privada** (no
compartido con otros consumidores).

`event_uuid` sigue siendo la clave de idempotencia (dedupe al
reprocesar) pero **no** se usa como cursor.

Cualquier consumidor del Event Store — Pulso hoy, y cualquier otro
futuro — se rige por un conjunto común de principios: read-only sobre
la tabla, cursor privado, consumo secuencial por `id`, idempotencia
obligatoria, retention-aware, filtro por tipo en la api (no en el
cliente), sin acoplamiento entre consumidores, política explícita de
cursor inicial al arrancar sin estado, backoff en errores,
observabilidad mínima de su propio progreso.

No se adopta ninguna infraestructura de mensajería externa (broker,
cola, stream). El descubrimiento se apoya exclusivamente en Postgres
+ HTTP ya presentes.

## Consecuencias positivas

- **Determinismo total**: `id > N` es estricto y monotónico. Un mismo
  `after_id` produce siempre el mismo conjunto de eventos (append-only
  lo garantiza).
- **Sin dependencia de relojes**: el orden lo asigna Postgres al
  insertar. Divergencias arbitrarias entre reloj de productor, DB y
  consumidor no afectan al consumo.
- **Sin bordes ambiguos**: dos eventos con timestamps idénticos
  (posible bajo alta concurrencia) siguen teniendo `id` distintos y
  ordenables. Nunca se pierden ni se duplican por igualdad de `ts`.
- **Recuperación trivial**: consumidor caído durante horas o días
  arranca con su `last_processed_id` guardado y se pone al día en el
  siguiente poll. Los eventos no se pierden porque la fuente de verdad
  es la tabla append-only, no un mensaje efímero.
- **Idempotencia natural del transporte**: `GET /events?after_id=N` es
  idempotente por HTTP; reintentar en fallos de red es seguro.
- **Múltiples consumidores sin coordinación**: cada uno lleva su cursor
  privado. Añadir un consumidor nuevo no toca a los existentes ni al
  productor.
- **Cero infraestructura nueva**: no se añade broker, stream, ni
  servicio de mensajería. La complejidad operativa del proyecto no
  crece.

## Consecuencias negativas

- **Latencia mínima acotada por el intervalo de poll**: no es tiempo
  real. Consumidores con SLAs de latencia dura no se sirven bien con
  este patrón.
- **Overhead de queries constantes** incluso en ausencia de eventos
  nuevos. Bajo la carga esperada del proyecto es despreciable; escala
  linealmente con el número de consumidores.
- **Sin backpressure natural**: un consumidor lento no informa al
  productor. Aceptable porque los eventos ya están persistidos y no
  se pierden; el consumidor se atrasa, no rompe nada.
- **Retention futura requerirá contrato adicional**: si algún día se
  purga la tabla, consumidores con `after_id` anterior al oldest
  disponible necesitan una convención de respuesta (por ejemplo HTTP
  410 más `oldest_available_id`). Reconocido en los principios pero
  aún no implementado — cuando llegue retention, será una revisión
  incremental de este ADR o un ADR nuevo.
- **Filtro `types` obligatorio para eficiencia**: consumidores que
  pidan sin filtro descargan todo el flujo, cargando innecesariamente
  api y red. La disciplina la pone el diseño del consumidor.

## Alternativas descartadas

- **Cursor por timestamp** (`since=<ts>`): rompe determinismo por
  clock skew entre productor, DB y consumidor; ambiguo cuando dos
  eventos comparten `ts`.
- **Cursor por `event_uuid` solamente**: UUID v4 es aleatorio, no
  ordenable naturalmente. Sirve como clave de idempotencia, no como
  cursor.
- **Postgres `LISTEN` / `NOTIFY`**: requiere que el consumidor
  mantenga conexión persistente a Postgres, violando ADR-009. Además
  `NOTIFY` es efímero: eventos emitidos con el consumidor caído se
  pierden como aviso, y el consumidor tendría que caer igualmente a un
  polling de recuperación.
- **Webhook push api → consumidor**: latencia baja pero introduce
  responsabilidad de entrega garantizada en la api (reintentos, colas
  de dead-letter) y obliga a cada consumidor a exponer un puerto.
- **Broker / cola de mensajes** (Redis Streams, NATS JetStream,
  RabbitMQ, Kafka): añade un servicio nuevo con su propia disciplina
  operativa (backups, monitoreo, versiones, tópicos). Sobredimensionado
  para la carga y la topología actuales. Se revisará cuando aparezca
  una necesidad real de fan-out multi-consumidor a gran escala o de
  SLAs de latencia dura.

## Referencias cruzadas

- ADR-001 — la invariante "sólo `api` toca la DB" que este ADR
  respeta a nivel de mecanismo de consumo.
- ADR-007 — cutoff oficial de captura; los consumidores que hacen
  replay total lo usan como límite inferior al arrancar sin estado.
- ADR-009 — el patrón HTTP sobre el que se apoya este consumo.
- `docs/event-catalog.md` — schema y semántica de los eventos que se
  consumen; la columna `id` como cursor está definida allí.
