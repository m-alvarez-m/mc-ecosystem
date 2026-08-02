import { describe, it, expect, vi } from "vitest";
import {
  composeApp,
  createHandlerRegistrations,
  seedInitialCursor,
} from "../src/bootstrap/compose";
import type { CursorData, CursorStore } from "../src/cursor";
import type { Config } from "../src/config/env";
import { DiscordPublisher } from "../src/discord/discord-publisher";
import { EventDispatcher } from "../src/dispatcher";
import { EventStoreClient } from "../src/eventstore";
import { FileCursorStore } from "../src/cursor";
import { PollingEngine } from "../src/polling";
import { PlayerNameResolver } from "../src/players";
import { RuntimeState } from "../src/observability";
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
  CraftHandler,
  VillagerTradeHandler,
  ProgressHandler,
  TechnologyHandler,
  ExplorationHandler,
} from "../src/handlers";

// Tests del bootstrap.
// composeApp() es una factoria pura; los tests la ejecutan sin miedo
// (no toca red ni disco). start()/stop() no se ejercitan aqui.

function fakeConfig(): Config {
  return {
    discord: {
      token: "fake-token",
      guildId: "123456789012345678",
      eventsChannelId: "987654321098765432",
    },
    server: { port: 4000 },
    eventStore: { baseUrl: "http://api:3000", timeoutMs: 10_000 },
    cursor: { filePath: "/tmp/pulso/cursor.json" },
    polling: { intervalMs: 5_000 },
    tps: { alertThreshold: 18 },
    freshness: { thresholdMs: 120_000 },
  };
}

// ------------------------------------------------------------------
// createHandlerRegistrations
// ------------------------------------------------------------------

const EXPECTED_TYPES = [
  "server.start",
  "server.stop",
  "session.start",
  "session.end",
  "player.death",
  "advancement.done",
  "chat.message",
  "server.tps_sample",
  "backup.done",
  "dimension.enter",
  "milestone.first",
  "boss.kill",
  "player.kill",
  "item.craft",
  "villager.trade",
  "item.enchant",
  "block.place",
  "chunk.first_load",
] as const;

const EXPECTED_HANDLER_CTORS = [
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
  CraftHandler,
  VillagerTradeHandler,
  ProgressHandler,
  TechnologyHandler,
  ExplorationHandler,
];

describe("createHandlerRegistrations", () => {
  it("registra exactamente 18 handlers", () => {
    const regs = createHandlerRegistrations(fakeConfig());
    expect(regs).toHaveLength(18);
  });

  it("cubre los tipos de evento esperados y en el orden esperado", () => {
    const types = createHandlerRegistrations(fakeConfig()).map((r) => r.eventType);
    expect(types).toEqual([...EXPECTED_TYPES]);
  });

  it("cada tipo mapea a una instancia unica (sin duplicados de tipo ni handler)", () => {
    const regs = createHandlerRegistrations(fakeConfig());
    const seenTypes = new Set(regs.map((r) => r.eventType));
    const seenHandlers = new Set(regs.map((r) => r.handler));
    expect(seenTypes.size).toBe(regs.length);
    expect(seenHandlers.size).toBe(regs.length);
  });

  it("cada handler es instancia de la clase esperada", () => {
    const regs = createHandlerRegistrations(fakeConfig());
    for (let i = 0; i < regs.length; i++) {
      expect(regs[i]!.handler).toBeInstanceOf(EXPECTED_HANDLER_CTORS[i]!);
    }
  });

  it("cada handler soporta el tipo bajo el que se registra (supports() -> true)", () => {
    for (const { eventType, handler } of createHandlerRegistrations(fakeConfig())) {
      expect(handler.supports(eventType)).toBe(true);
    }
  });

  it("cada llamada devuelve INSTANCIAS nuevas (aisla estados en tests)", () => {
    const first = createHandlerRegistrations(fakeConfig());
    const second = createHandlerRegistrations(fakeConfig());
    for (let i = 0; i < first.length; i++) {
      expect(first[i]!.handler).not.toBe(second[i]!.handler);
    }
  });
});

// ------------------------------------------------------------------
// composeApp
// ------------------------------------------------------------------

describe("composeApp", () => {
  it("crea el grafo completo de servicios con los tipos esperados", () => {
    const app = composeApp(fakeConfig());

    // Cliente Discord: presente (no verificamos tipo exacto porque
    // Client de discord.js es opaco/complejo; verificamos que existe
    // y responde a la API que consumimos).
    expect(app.services.client).toBeDefined();
    expect(typeof app.services.client.isReady).toBe("function");
    expect(typeof app.services.client.destroy).toBe("function");

    expect(app.services.publisher).toBeInstanceOf(DiscordPublisher);
    expect(app.services.dispatcher).toBeInstanceOf(EventDispatcher);
    expect(app.services.eventStoreClient).toBeInstanceOf(EventStoreClient);
    expect(app.services.cursorStore).toBeInstanceOf(FileCursorStore);
    expect(app.services.pollingEngine).toBeInstanceOf(PollingEngine);
    expect(app.services.playerNameResolver).toBeInstanceOf(PlayerNameResolver);
    expect(app.services.runtimeState).toBeInstanceOf(RuntimeState);
  });

  it("runtimeState arranca en cero: cero eventos procesados, cero errores, timestamps null", () => {
    const app = composeApp(fakeConfig());
    const s = app.services.runtimeState.snapshot();

    expect(s.processedEventsTotal).toBe(0);
    expect(s.unknownEventsTotal).toBe(0);
    expect(s.pollingErrorsTotal).toBe(0);
    expect(s.handlerErrorsTotal).toBe(0);
    expect(s.lastPollAt).toBeNull();
    expect(s.lastSuccessfulPollAt).toBeNull();
    expect(s.lastError).toBeNull();
    expect(s.lastEventProcessed).toBeNull();
  });

  it("dispatcher wired: onUnknown incrementa runtimeState.unknownEventsTotal", async () => {
    // Dispatch de un tipo NO registrado a traves del dispatcher REAL
    // compuesto — verifica que el callback onUnknown esta cableado a
    // runtimeState. No dispara ningun handler, cero side effects.
    const app = composeApp(fakeConfig());
    const unknownEvent = {
      id: "1",
      event_uuid: "00000000-0000-4000-8000-000000000001",
      type: "tipo.que.nadie.registra",
      v: 1,
      ts: "2026-07-27T00:00:00.000Z",
      received_at: "2026-07-27T00:00:00.010Z",
      player_uuid: null,
      world: null,
      x: null,
      y: null,
      z: null,
      data: {},
    };

    await app.services.dispatcher.dispatch([unknownEvent]);

    const s = app.services.runtimeState.snapshot();
    expect(s.unknownEventsTotal).toBe(1);
    expect(s.processedEventsTotal).toBe(0);
  });

  it("expone start() y stop() como unico punto de entrada operacional", () => {
    const app = composeApp(fakeConfig());
    expect(typeof app.start).toBe("function");
    expect(typeof app.stop).toBe("function");
  });

  it("el pollingEngine arranca en isRunning=false (no lo activa compose)", () => {
    const app = composeApp(fakeConfig());
    expect(app.services.pollingEngine.isRunning()).toBe(false);
  });

  it("dispatcher registrado con los 18 handlers: dispatch de tipos conocidos NO invoca onUnknown", async () => {
    // Test integracion: verificamos que TODOS los tipos esperados
    // llegan a un handler registrado, usando el hook onUnknown como
    // deteccion de "gap" (handler no registrado -> onUnknown se llama).
    //
    // Necesitamos un dispatcher con onUnknown observable. compose() no
    // permite inyectarlo, asi que recreamos el mismo registro con el
    // hook activo. Esto testea que la LISTA de tipos y su registrabilidad
    // en un dispatcher real son consistentes.
    const seenUnknown: string[] = [];
    const context = {
      publisher: { publish: async () => undefined },
      playerNameResolver: {
        resolve: async () => "TestName",
      } as unknown as PlayerNameResolver,
      logger: { warn: () => undefined },
      freshnessThresholdMs: 120000,
    };
    const dispatcher = new EventDispatcher({
      context,
      onUnknown: (event) => seenUnknown.push(event.type),
    });
    for (const { eventType, handler } of createHandlerRegistrations(fakeConfig())) {
      dispatcher.register(eventType, handler);
    }

    // Un evento (con payload invalido intencionalmente) por cada tipo
    // esperado. handler.handle puede lanzar por payload malo, pero
    // el punto es probar RUTING: si el handler existe, el evento no
    // cae en onUnknown; si el handler lanza, es HandlerExecutionError
    // (no onUnknown).
    for (const type of EXPECTED_TYPES) {
      const event = {
        id: "1",
        event_uuid: "00000000-0000-4000-8000-000000000001",
        type,
        v: 1,
        ts: "2026-07-27T00:00:00.000Z",
        received_at: "2026-07-27T00:00:00.010Z",
        player_uuid: null,
        world: null,
        x: null,
        y: null,
        z: null,
        data: {},
      };
      // Ignoramos el error si viene: no es la asercion de este test.
      await dispatcher.dispatch([event]).catch(() => undefined);
    }

    expect(seenUnknown).toEqual([]);
  });

  it("dispatcher SI reporta onUnknown para tipos NO registrados", async () => {
    const seenUnknown: string[] = [];
    const context = {
      publisher: { publish: async () => undefined },
      playerNameResolver: {
        resolve: async () => "TestName",
      } as unknown as PlayerNameResolver,
      logger: { warn: () => undefined },
      freshnessThresholdMs: 120000,
    };
    const dispatcher = new EventDispatcher({
      context,
      onUnknown: (event) => seenUnknown.push(event.type),
    });
    for (const { eventType, handler } of createHandlerRegistrations(fakeConfig())) {
      dispatcher.register(eventType, handler);
    }

    const unknownEvent = {
      id: "1",
      event_uuid: "00000000-0000-4000-8000-000000000001",
      type: "tipo.que.nadie.registra",
      v: 1,
      ts: "2026-07-27T00:00:00.000Z",
      received_at: "2026-07-27T00:00:00.010Z",
      player_uuid: null,
      world: null,
      x: null,
      y: null,
      z: null,
      data: {},
    };
    await dispatcher.dispatch([unknownEvent]);

    expect(seenUnknown).toEqual(["tipo.que.nadie.registra"]);
  });
});

// ------------------------------------------------------------------
// seedInitialCursor (T3 v1.1)
// ------------------------------------------------------------------

function silentLogger(): Pick<import("pino").Logger, "info"> & {
  info: ReturnType<typeof vi.fn>;
} {
  return { info: vi.fn() };
}

function fakeCursorStore(overrides: {
  loadResult?: CursorData | null;
  loadError?: Error;
  saveError?: Error;
}): CursorStore & {
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
} {
  const load = vi.fn(async () => {
    if (overrides.loadError !== undefined) throw overrides.loadError;
    return overrides.loadResult ?? null;
  });
  const save = vi.fn(async () => {
    if (overrides.saveError !== undefined) throw overrides.saveError;
  });
  return { load, save } as unknown as CursorStore & {
    load: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
}

function fakeLatestIdFetcher(
  overrides: { result?: string | null; error?: Error },
): {
  getLatestEventId: ReturnType<typeof vi.fn>;
} {
  const getLatestEventId = vi.fn(async () => {
    if (overrides.error !== undefined) throw overrides.error;
    return overrides.result ?? null;
  });
  return { getLatestEventId };
}

describe("seedInitialCursor", () => {
  it("cursor existente: NO consulta latest_id, NO guarda cursor", async () => {
    const cursorStore = fakeCursorStore({
      loadResult: { event_id: "500", updated_at: "2026-07-30T00:00:00Z" },
    });
    const eventStoreClient = fakeLatestIdFetcher({});
    const logger = silentLogger();

    await seedInitialCursor({ cursorStore, eventStoreClient, logger });

    expect(cursorStore.load).toHaveBeenCalledOnce();
    expect(eventStoreClient.getLatestEventId).not.toHaveBeenCalled();
    expect(cursorStore.save).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("sin cursor + latest_id string: consulta UNA vez y guarda el cursor con ese id", async () => {
    const cursorStore = fakeCursorStore({ loadResult: null });
    const eventStoreClient = fakeLatestIdFetcher({ result: "14028" });
    const logger = silentLogger();

    await seedInitialCursor({ cursorStore, eventStoreClient, logger });

    expect(cursorStore.load).toHaveBeenCalledOnce();
    expect(eventStoreClient.getLatestEventId).toHaveBeenCalledOnce();
    expect(cursorStore.save).toHaveBeenCalledOnce();
    expect(cursorStore.save.mock.calls[0]![0]).toBe("14028");
    // Log informativo con el id sembrado.
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.info.mock.calls[0]![0]).toEqual({ event_id: "14028" });
  });

  it("sin cursor + latest_id null: NO guarda cursor, log informativo", async () => {
    const cursorStore = fakeCursorStore({ loadResult: null });
    const eventStoreClient = fakeLatestIdFetcher({ result: null });
    const logger = silentLogger();

    await seedInitialCursor({ cursorStore, eventStoreClient, logger });

    expect(eventStoreClient.getLatestEventId).toHaveBeenCalledOnce();
    expect(cursorStore.save).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledOnce();
    // Mensaje explícito de "vacío".
    expect(String(logger.info.mock.calls[0]![0])).toMatch(/vac[ií]o|empty/i);
  });

  it("fallo en cursorStore.load: propaga, NO consulta latest_id", async () => {
    const boom = new Error("load boom");
    const cursorStore = fakeCursorStore({ loadError: boom });
    const eventStoreClient = fakeLatestIdFetcher({});
    const logger = silentLogger();

    await expect(
      seedInitialCursor({ cursorStore, eventStoreClient, logger }),
    ).rejects.toBe(boom);
    expect(eventStoreClient.getLatestEventId).not.toHaveBeenCalled();
    expect(cursorStore.save).not.toHaveBeenCalled();
  });

  it("fallo en getLatestEventId: propaga (fail-fast del arranque), NO guarda cursor", async () => {
    const apiBoom = new Error("api down");
    const cursorStore = fakeCursorStore({ loadResult: null });
    const eventStoreClient = fakeLatestIdFetcher({ error: apiBoom });
    const logger = silentLogger();

    await expect(
      seedInitialCursor({ cursorStore, eventStoreClient, logger }),
    ).rejects.toBe(apiBoom);
    expect(cursorStore.save).not.toHaveBeenCalled();
  });

  it("fallo en cursorStore.save: propaga", async () => {
    const saveBoom = new Error("disk full");
    const cursorStore = fakeCursorStore({ loadResult: null, saveError: saveBoom });
    const eventStoreClient = fakeLatestIdFetcher({ result: "999" });
    const logger = silentLogger();

    await expect(
      seedInitialCursor({ cursorStore, eventStoreClient, logger }),
    ).rejects.toBe(saveBoom);
  });
});
