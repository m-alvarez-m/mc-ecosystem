# Bot Pulso

Bot de Discord que expone en casi tiempo real la actividad del ecosistema
Minecraft (roadmap v1.1 "Pulso"). Consumidor read-only del Event Store.

Ver:

- [`docs/adr/008-stack-servicio-pulso.md`](../docs/adr/008-stack-servicio-pulso.md)
- [`docs/adr/009-api-http-superficie-unica-db.md`](../docs/adr/009-api-http-superficie-unica-db.md)
- [`docs/adr/010-consumo-event-store-cursor-id.md`](../docs/adr/010-consumo-event-store-cursor-id.md)
- [`docs/pulso-bot-design.md`](../docs/pulso-bot-design.md) — diseño completo.

## Estado

**Bootstrap inicial**. El servicio arranca, valida configuración, se
conecta a Discord y expone `GET /health`. NO consume el Event Store,
NO publica mensajes, NO registra slash commands. La lógica de negocio
llega en sesiones posteriores del roadmap.

## Requisitos

- Node.js LTS (24 o superior).
- Variables de entorno (definir en `bot/.env` para dev, inyectadas
  desde `infra/.env` vía Docker Compose para deploy):
  - `DISCORD_BOT_TOKEN`
  - `DISCORD_GUILD_ID`
  - `DISCORD_EVENTS_CHANNEL_ID`
  - `PORT`

Si falta cualquiera al arrancar, el servicio termina con `exit(1)`
listando qué falta. Sin fallbacks silenciosos.

## Scripts

- `npm run dev` — arranque con recarga vía tsx.
- `npm run build` — compila TypeScript a `dist/`.
- `npm run start` — corre el build compilado.
- `npm run test` — tests unitarios (vitest).
- `npm run typecheck` — verifica tipos sin generar `dist`.

## Estructura

```
src/
├── index.ts              Entry point: config -> Discord -> HTTP -> shutdown
├── config/env.ts         Carga tipada y validación de variables
├── discord/client.ts     Cliente Discord + login + ready
├── health/server.ts      Servidor HTTP con GET /health (liveness)
├── lifecycle/shutdown.ts Cierre limpio SIGINT/SIGTERM
└── types/                Placeholder para tipos compartidos futuros
test/
└── config.test.ts        Tests del cargador de config
```

## Health

Endpoint único: `GET /health` en el `PORT` configurado. Responde `200
{"status":"ok"}` cuando el cliente Discord está `ready`, `503
{"status":"not-ready"}` mientras arranca. En esta versión **liveness
y readiness comparten implementación**; ADR-008 contempla diferenciar
`/ready` cuando aparezca caso de uso.
