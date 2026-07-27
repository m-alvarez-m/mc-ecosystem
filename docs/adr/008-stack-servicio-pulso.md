# ADR-008: Stack tecnológico del servicio Pulso

- **Fecha**: 2026-07-26
- **Estado**: aceptado

## Contexto

El proyecto está introduciendo un servicio nuevo (Pulso) que consumirá
el Event Store del ecosistema y publicará en Discord. El monorepo ya
tiene la api en Node.js + TypeScript + Fastify + pg, y el placeholder
`packages/shared` reservado para tipos compartidos entre productores y
consumidores.

## Problema

Elegir el stack (lenguaje, runtime, librería Discord) del nuevo
servicio sabiendo que la decisión sentará el patrón para servicios
consumidores futuros del monorepo.

## Decisión

El servicio Pulso se construye sobre **Node.js LTS + TypeScript +
discord.js v14**. Los tipos que representan el catálogo de eventos
(v1) viven en `packages/shared` para ser consumidos por cualquier
servicio TypeScript del monorepo.

## Consecuencias positivas

- Un único toolchain para todos los servicios propios (api, Pulso,
  consumidores futuros TypeScript): mismo `tsc`, mismo `node`, mismo
  patrón de `package.json`, mismos linters.
- `packages/shared` se justifica como paquete real: exporta tipos
  derivados del catálogo, consumidos tanto por productores (api al
  validar) como por consumidores (Pulso al deserializar).
- discord.js v14 es el punto de Schelling del ecosistema Discord: la
  mayoría de docs, tutoriales, plantillas e issues públicos asumen
  esta librería.
- Tipos oficiales robustos y comunidad activa; onboarding rápido para
  cualquiera que contribuya después.

## Consecuencias negativas

- discord.js es opinionada (event emitter clásico, cache pesada) — mayor
  huella de RAM que alternativas minimalistas como Eris.
- La librería rompe APIs entre versiones mayores (v13 → v14 fue
  disruptivo); actualizaciones mayores requerirán revisión explícita.
- Node/TypeScript centralizan homogeneidad y también fragilidad: una
  vulnerabilidad grave en el ecosistema npm afecta a todos los
  servicios propios simultáneamente.

## Alternativas descartadas

- **Node.js + Eris**: más ligero, pero comunidad menor y ayuda
  fragmentada; el ahorro de RAM no compensa el aislamiento del
  ecosistema.
- **Python + discord.py / py-cord**: rompe la homogeneidad TypeScript
  del monorepo e introduce un segundo runtime a mantener.
- **Rust + serenity**: curva de desarrollo alta para un servicio
  conversacional que va a evolucionar rápidamente; introduciría un
  tercer lenguaje.

## Referencias cruzadas

- ADR-001 — modo offline + AuthMe: la disciplina de mantener el stack
  técnico controlado nace ahí.
- ADR-009 — el patrón HTTP presume tipos compartidos TypeScript entre
  productores y consumidores.
- ADR-010 — el consumo del Event Store se implementa sobre este stack.
