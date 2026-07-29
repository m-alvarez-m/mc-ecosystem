import pino from "pino";
import type { Config } from "../config/env";
import { createDiscordClient } from "../discord/client";
import { DiscordPublisher } from "../discord/discord-publisher";
import type { DispatchContext } from "../context";
import { EventDispatcher } from "../dispatcher";
import type { EventHandler } from "../dispatcher";
import { EventStoreClient } from "../eventstore";
import { FileCursorStore } from "../cursor";
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
export function createHandlerRegistrations(): ReadonlyArray<{
  eventType: string;
  handler: EventHandler;
}> {
  // Tipos alineados con docs/event-catalog.md. Cambiar cualquiera
  // requiere tambien cambiar el EVENT_TYPE del handler correspondiente,
  // porque el dispatcher.register() verifica handler.supports(type).
  return [
    { eventType: "server.start", handler: new ServerStartedHandler() },
    { eventType: "server.stop", handler: new ServerStoppedHandler() },
    { eventType: "session.start", handler: new PlayerJoinedHandler() },
    { eventType: "session.end", handler: new PlayerLeftHandler() },
    { eventType: "player.death", handler: new PlayerDeathHandler() },
    { eventType: "advancement.done", handler: new AdvancementHandler() },
    { eventType: "chat.message", handler: new ChatHandler() },
    { eventType: "server.tps_sample", handler: new TpsHandler() },
    { eventType: "backup.done", handler: new BackupHandler() },
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

  // Dispatcher + handlers
  const context: DispatchContext = { publisher };
  const dispatcher = new EventDispatcher({ context });
  for (const { eventType, handler } of createHandlerRegistrations()) {
    dispatcher.register(eventType, handler);
  }

  // Consumo del Event Store
  const eventStoreClient = new EventStoreClient({
    baseUrl: config.eventStore.baseUrl,
    timeoutMs: config.eventStore.timeoutMs,
  });
  const cursorStore = new FileCursorStore({ filePath: config.cursor.filePath });

  // Polling: el consumer entrega lotes al dispatcher (ver ADR-010).
  const pollingEngine = new PollingEngine({
    eventStoreClient,
    cursorStore,
    consumer: (events) => dispatcher.dispatch(events),
    pollIntervalMs: config.polling.intervalMs,
  });

  const services: AppServices = {
    client,
    publisher,
    dispatcher,
    eventStoreClient,
    cursorStore,
    pollingEngine,
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
