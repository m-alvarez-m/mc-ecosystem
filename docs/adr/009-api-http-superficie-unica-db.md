# ADR-009: `api` HTTP como superficie única de la base de datos

- **Fecha**: 2026-07-26
- **Estado**: aceptado

## Contexto

La tabla `events` en Postgres almacena toda la telemetría del
ecosistema. Desde el inicio del proyecto (ver ADR-001) sólo el rol
`mc_app` de la api Fastify tiene privilegios de escritura sobre esa
tabla, y el plugin Java emite eventos vía `POST /events`. Con la
llegada de v1.1 aparece un servicio nuevo (Pulso) y se anticipan
consumidores adicionales (Insight, Genesis, otros aún no diseñados)
que necesitarán leer eventos.

## Problema

Definir el patrón oficial de acceso a datos para consumidores del
Event Store: acceso directo a Postgres, mediación por HTTP, o híbrido.
La decisión debe permanecer válida aunque los consumidores concretos
cambien en el futuro.

## Decisión

**Todo consumidor del Event Store accede exclusivamente vía HTTP
contra la api.** La api es la **única superficie** que ejecuta SQL
contra `events` y sus satélites (`players`, `player_names`). Los
endpoints expuestos son **genéricos** (aplicables a cualquier
consumidor) y no específicos por caso de uso; los endpoints
"derivados" convenientes que puedan aparecer son proyecciones
optimizadas de queries que cualquier consumidor podría reconstruir
por sí mismo a partir de los endpoints genéricos.

Ningún consumidor recibe credenciales de Postgres. Ningún consumidor
crea su propio rol de sólo lectura contra la DB.

## Consecuencias positivas

- Contrato explícito (HTTP + schemas) desacoplado del schema físico
  de la DB: migraciones, cambios de columna o de índices son problema
  de un único servicio.
- Los cross-cutting concerns (validación de entrada, autorización,
  caching, rate limiting, observabilidad) se aplican **una sola vez**
  en la api y todos los consumidores los heredan gratis.
- Cero fragmentación de la lógica de acceso: una única superficie sabe
  SQL. Los consumidores razonan sobre un contrato, no sobre un schema.
- Nuevos consumidores son additive por diseño: se enchufan al mismo
  contrato sin coordinar con los existentes ni tocar la DB.
- La invariante enunciada en ADR-001 se preserva y refuerza como
  regla arquitectónica del proyecto, no como accidente histórico.

## Consecuencias negativas

- Añadir un endpoint HTTP a la api tiene más fricción que hacer un
  `SELECT` directo desde el consumidor — el equipo debe internalizar
  este trade-off al diseñar features nuevas.
- Latencia de red intermedia (despreciable en la red interna del
  compose, sub-milisegundo, pero contable si algún consumidor se aloja
  fuera).
- La api se vuelve single point of failure también para lectura: si
  la api cae, ningún consumidor lee eventos aunque Postgres esté sano.
  Mitigación: monitoreo de la api sube en prioridad, y la api sigue
  siendo un servicio simple y sin estado (fácil de reiniciar).

## Alternativas descartadas

- **Lectura directa DB por consumidor** (cada uno con su propio rol
  `SELECT`): mínima latencia, pero acopla al schema físico, replica
  optimizaciones en cada consumidor y viola la invariante de ADR-001.
- **Híbrido** (DB directa para queries analíticas, HTTP para acciones
  interactivas): dos superficies de acoplamiento indistinguibles en
  revisión de código; erosión inevitable de la disciplina con el
  tiempo.
- **gRPC / conexión persistente** en lugar de HTTP REST: aporta poco
  a la carga y patrones actuales, exige runtime adicional en cada
  consumidor.

## Referencias cruzadas

- ADR-001 — modo offline + AuthMe: origen de la invariante "sólo `api`
  toca la DB".
- ADR-010 — define el mecanismo concreto de consumo (cursor por `id`)
  sobre este patrón HTTP.
- `docs/event-catalog.md` — contrato de datos que la api expone.
