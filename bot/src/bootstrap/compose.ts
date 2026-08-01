import pino, { type Logger } from "pino";
import type { Config } from "../config/env";
import { createDiscordClient } from "../discord/client";
import { DiscordPublisher } from "../discord/discord-publisher";
import type { DispatchContext } from "../context";
import { EventDispatcher } from "../dispatcher";
import type { EventHandler } from "../dispatcher";
import { EventStoreClient } from "../eventstore";
import { FileCursorStore } from "../cursor";
import type { CursorStore } from "../cursor";
import { RuntimeState } from "../observability";
import { PlayerNameResolver } from "../players";
import { PollingEngine } from "../polling";
import {
  ServerStartedHandler,
  ServerStoppedHandler,
  PlayerJoinedHandler,
  PlayerLeftHandler,
  PlayerDeathHandler,
  AdvancementHandler,
  ChatHandler,
  TpsHandler,
  BackupHandler,
  DimensionHandler,
  ServerMilestoneHandler,
  BossKillHandler,
  PlayerKillHandler,
} from "../handlers";
import type { Client } from "discord.js";

// Composicion del grafo de dependencias del bot Pulso.
//
// Este modulo es la UNICA parte del bot que conoce a la vez todas las
// capas. Cada capa individual sigue siendo agnostica de las demas
// (los handlers no importan Discord, el polling no conoce Discord,
// etc.); el "pegamento" vive aqui, se ejecuta una vez al arrancar el
// proceso, y no se toca en runtime.
//
// composeApp() es una factoria PURA — no hace IO. Todo lo que
// requiere red o disco (login Discord, arrancar polling) vive en
// App.start() para que los tests puedan verificar el grafo sin tocar
// el mundo exterior.

/**
 * Registro canonico de handlers del bot Pulso. Cada entrada mapea un
 * tipo del catalogo al handler concreto que lo maneja.
 *
 * Se define como funcion (no como constante) para que cada llamada
 * cree instancias nuevas — util para tests aislados y para posibles
 * multiples instancias del bot en el mismo proceso.
 *
 * Registro EXPLICITO por diseno: sin auto-discovery, sin reflexion,
 * sin scan de directorios. Anadir un handler nuevo requiere editar
 * esta lista, lo cual es exactamente el tipo de cambio que quieres
 * ver en revision de codigo.
 */
export function createHandlerRegistrations(config: Config): ReadonlyArray<{
  eventType: string;
  handler: EventHandler;
}> {
  // Tipos alineados con docs/event-catalog.md. Cambiar cualquiera
  // requiere tambien cambiar el EVENT_TYPE del handler correspondiente,
  // porque el dispatcher.register() verifica handler.supports(type).
  //
  // Handlers con configuracion propia reciben aqui su subset via
  // constructor. TpsHandler recibe el umbral de alerta (T2 v1.1).
  return [
    { eventType: "server.start", handler: new ServerStartedHandler() },
    { eventType: "server.stop", handler: new ServerStoppedHandler() },
    { eventType: "session.start", handler: new PlayerJoinedHandler() },
    { eventType: "session.end", handler: new PlayerLeftHandler() },
    { eventType: "player.death", handler: new PlayerDeathHandler() },
    { eventType: "advancement.done", handler: new AdvancementHandler() },
    { eventType: "chat.message", handler: new ChatHandler() },
    {
      eventType: "server.tps_sample",
      handler: new TpsHandler({ alertThreshold: config.tps.alertThreshold }),
    },
    { eventType: "backup.done", handler: new BackupHandler() },
    { eventType: "dimension.enter", handler: new DimensionHandler() },
    { eventType: "milestone.first", handler: new ServerMilestoneHandler() },
    { eventType: "boss.kill", handler: new BossKillHandler() },
    { eventType: "player.kill", handler: new PlayerKillHandler() },
  ];
}

/**
 * Servicios compuestos por el bootstrap. Se exponen todos para
 * permitir inspeccion en tests, healthchecks futuros, o wiring
 * adicional (p.ej. `src/index.ts` re-usando el mismo cliente para
 * su servidor HTTP de health).
 */
export interface AppServices {
  client: Client;
  publisher: DiscordPublisher;
  dispatcher: EventDispatcher;
  eventStoreClient: EventStoreClient;
  cursorStore: FileCursorStore;
  pollingEngine: PollingEngine;
  playerNameResolver: PlayerNameResolver;
  runtimeState: RuntimeState;
}

/**
 * Handle completo del bot compuesto. `services` para inspeccion;
 * `start()` / `stop()` como unico punto de entrada operacional.
 */
export interface App {
  services: AppServices;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Dependencias de seedInitialCursor. `eventStoreClient` se toma como
 * subset estructural (`getLatestEventId` unicamente) para que los
 * tests puedan inyectar un stub sin fingir toda la superficie del
 * cliente HTTP. Mismo patron que EventFetcher en PollingEngine.
 */
export interface SeedInitialCursorDeps {
  cursorStore: CursorStore;
  eventStoreClient: { getLatestEventId(): Promise<string | null> };
  logger: Pick<Logger, "info">;
}

/**
 * Politica de cursor inicial (T3 v1.1 — skip-to-latest).
 *
 * Si ya existe cursor persistido → no-op. El polling continua desde
 * donde quedo.
 *
 * Si NO existe cursor → consulta el `latest_id` del Event Store:
 *   - null (Event Store vacio): no se siembra. El polling arrancara
 *     desde el inicio, que en este caso es "nada".
 *   - string (hay eventos): se siembra el cursor con ese id.
 *     Consumers evitan reprocesar la historia acumulada.
 *
 * Fail-fast: cualquier error de load/getLatestEventId/save se propaga
 * y aborta el arranque (App.start rechaza -> main() exit 1). NO hay
 * fallback al comportamiento anterior de "procesar todo desde 0" —
 * ese es exactamente el bug que este ticket resuelve.
 */
export async function seedInitialCursor(
  deps: SeedInitialCursorDeps,
): Promise<void> {
  const existing = await deps.cursorStore.load();
  if (existing !== null) {
    // Cursor ya persistido — nada que sembrar.
    return;
  }

  const latestId = await deps.eventStoreClient.getLatestEventId();
  if (latestId === null) {
    deps.logger.info(
      "Sin cursor previo y Event Store vacio — arrancando desde el inicio",
    );
    return;
  }

  await deps.cursorStore.save(latestId);
  deps.logger.info(
    { event_id: latestId },
    "Cursor inicial sembrado al ultimo id del Event Store (skip-to-latest)",
  );
}

/**
 * Compone el grafo de dependencias del bot. Puro y sincronico: no
 * hace login Discord, no arranca polling, no toca disco. Todo eso
 * vive en App.start().
 */
export function composeApp(config: Config): App {
  const logger = pino({ name: "pulso" });

  // Discord
  const client = createDiscordClient(logger);
  const publisher = new DiscordPublisher({
    client,
    channelId: config.discord.eventsChannelId,
  });

  // Resolucion de identidad. Se apoya en la misma api que el
  // EventStoreClient — reusa baseUrl y timeoutMs de config.eventStore.
  const playerNameResolver = new PlayerNameResolver({
    baseUrl: config.eventStore.baseUrl,
    timeoutMs: config.eventStore.timeoutMs,
  });

  // Observabilidad runtime (T5): contadores + timestamps + ultimos
  // errores/eventos. Sin persistencia; se pierde al reiniciar. El
  // health server futuro (T7) leera runtimeState.snapshot().
  const runtimeState = new RuntimeState();

  // Dispatcher + handlers. Callbacks cableados directamente a
  // runtimeState + logger. Politica de logging centralizada AQUI:
  // ningun handler / cliente / motor imprime nada.
  const context: DispatchContext = { publisher, playerNameResolver };
  const dispatcher = new EventDispatcher({
    context,
    onUnknown: (event) => {
      runtimeState.recordUnknownEvent(event);
      logger.warn(
        { type: event.type, event_uuid: event.event_uuid },
        "Evento sin handler registrado",
      );
    },
    onHandled: (event) => {
      runtimeState.recordEventProcessed(event);
    },
    onFailed: (event, err) => {
      runtimeState.recordHandlerFailure(event, err);
      logger.error(
        { err, type: event.type, event_uuid: event.event_uuid },
        "Handler fallido",
      );
    },
  });
  for (const { eventType, handler } of createHandlerRegistrations(config)) {
    dispatcher.register(eventType, handler);
  }

  // Consumo del Event Store
  const eventStoreClient = new EventStoreClient({
    baseUrl: config.eventStore.baseUrl,
    timeoutMs: config.eventStore.timeoutMs,
  });
  const cursorStore = new FileCursorStore({ filePath: config.cursor.filePath });

  // Polling: el consumer entrega lotes al dispatcher (ver ADR-010).
  // Callbacks instrumentan runtimeState y centralizan logging de
  // fallos de polling (network, cursor, wrapping de consumer, etc.).
  const pollingEngine = new PollingEngine({
    eventStoreClient,
    cursorStore,
    consumer: (events) => dispatcher.dispatch(events),
    pollIntervalMs: config.polling.intervalMs,
    onPollStarted: () => runtimeState.recordPollStarted(),
    onPollCompleted: () => runtimeState.recordPollCompleted(),
    onError: (err) => {
      runtimeState.recordPollFailed(err);
      logger.error(
        { err, code: err.code },
        "Iteracion de polling fallida",
      );
    },
  });

  const services: AppServices = {
    client,
    publisher,
    dispatcher,
    eventStoreClient,
    cursorStore,
    pollingEngine,
    playerNameResolver,
    runtimeState,
  };

  return {
    services,
    start: async () => {
      // Login primero. Esperamos "ready" antes de arrancar polling
      // para que el DiscordPublisher no rechace con
      // ClientDisconnectedError los primeros lotes.
      const ready = new Promise<void>((resolve) => {
        client.once("ready", () => resolve());
      });
      await client.login(config.discord.token);
      await ready;
      // Politica de cursor inicial (T3): si no hay cursor previo,
      // sembrar con MAX(id) actual para evitar reproceso masivo del
      // historial. Si falla, aborta el arranque.
      await seedInitialCursor({ cursorStore, eventStoreClient, logger });
      await pollingEngine.start();
    },
    stop: async () => {
      // Orden inverso al start: paramos primero el productor de
      // trabajo (polling), luego cerramos el cliente Discord. Si
      // polling.stop() lanza, seguimos con destroy() igualmente.
      try {
        await pollingEngine.stop();
      } finally {
        await client.destroy();
      }
    },
  };
}
