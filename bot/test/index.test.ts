import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import { main, type MainDependencies } from "../src/index";
import type { App } from "../src/bootstrap";
import type { Config } from "../src/config/env";
import type { Server } from "node:http";

// Tests del entry point.
// Todas las dependencias (loadConfig, composeApp, startHealthServer,
// processExit, registerSignal) se inyectan como fakes: cero red, cero
// filesystem, cero Discord, cero exits reales del proceso.

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
  };
}

interface FakeApp {
  services: {
    client: unknown;
    publisher: unknown;
    dispatcher: unknown;
    eventStoreClient: unknown;
    cursorStore: unknown;
    pollingEngine: unknown;
  };
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function makeFakeApp(overrides: Partial<FakeApp> = {}): FakeApp {
  return {
    services: {
      client: { isReady: () => false, destroy: async () => undefined },
      publisher: {},
      dispatcher: {},
      eventStoreClient: {},
      cursorStore: {},
      pollingEngine: {},
    },
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeFakeServer(): Server & { close: ReturnType<typeof vi.fn> } {
  return {
    close: vi.fn((cb?: (err?: Error) => void) => {
      if (cb) cb();
    }),
  } as unknown as Server & { close: ReturnType<typeof vi.fn> };
}

interface Harness {
  loadConfig: ReturnType<typeof vi.fn>;
  composeApp: ReturnType<typeof vi.fn>;
  startHealthServer: ReturnType<typeof vi.fn>;
  processExit: ReturnType<typeof vi.fn>;
  registerSignal: ReturnType<typeof vi.fn>;
  signals: Map<string, () => void>;
  app: FakeApp;
  server: Server;
  deps: MainDependencies;
}

function makeHarness(overrides: {
  configThrows?: Error;
  startThrows?: Error;
  app?: FakeApp;
} = {}): Harness {
  const app = overrides.app ?? makeFakeApp();
  const server = makeFakeServer();
  const signals = new Map<string, () => void>();

  const loadConfig = vi.fn(() => {
    if (overrides.configThrows) throw overrides.configThrows;
    return fakeConfig();
  });
  const composeApp = vi.fn(() => app as unknown as App);
  const startHealthServer = vi.fn(() => server);
  const processExit = vi.fn((_code: number) => {
    // No throw: dejamos que main resuelva o vuelva; tests observan.
    return undefined as never;
  });
  const registerSignal = vi.fn(
    (signal: "SIGINT" | "SIGTERM", handler: () => void) => {
      signals.set(signal, handler);
    },
  );

  if (overrides.startThrows) {
    app.start = vi.fn(async () => {
      throw overrides.startThrows;
    });
  }

  const deps: MainDependencies = {
    loadConfig,
    composeApp,
    startHealthServer,
    logger: pino({ level: "silent" }),
    processExit,
    registerSignal,
  };

  return {
    loadConfig,
    composeApp,
    startHealthServer,
    processExit,
    registerSignal,
    signals,
    app,
    server,
    deps,
  };
}

describe("main (entry point)", () => {
  it("invoca app.start() tras componer la app", async () => {
    const h = makeHarness();
    await main(h.deps);

    expect(h.composeApp).toHaveBeenCalledTimes(1);
    expect(h.composeApp).toHaveBeenCalledWith(fakeConfig());
    expect(h.app.start).toHaveBeenCalledTimes(1);
    expect(h.processExit).not.toHaveBeenCalled();
  });

  it("arranca el health server usando el client de la app compuesta", async () => {
    const h = makeHarness();
    await main(h.deps);

    expect(h.startHealthServer).toHaveBeenCalledTimes(1);
    const arg = h.startHealthServer.mock.calls[0]![0] as {
      client: unknown;
      port: number;
    };
    // Misma referencia al client de la app compuesta (no un client nuevo).
    expect(arg.client).toBe(h.app.services.client);
    expect(arg.port).toBe(fakeConfig().server.port);
  });

  it("registra handlers de SIGINT y SIGTERM", async () => {
    const h = makeHarness();
    await main(h.deps);

    expect(h.signals.has("SIGINT")).toBe(true);
    expect(h.signals.has("SIGTERM")).toBe(true);
  });

  it("SIGINT llama a app.stop() y cierra el health server", async () => {
    const h = makeHarness();
    await main(h.deps);

    const handler = h.signals.get("SIGINT")!;
    handler();

    // El handler dispara shutdown async; esperamos a que se procese.
    await new Promise((r) => setImmediate(r));

    expect(h.app.stop).toHaveBeenCalledTimes(1);
    expect((h.server as unknown as { close: ReturnType<typeof vi.fn> }).close)
      .toHaveBeenCalledTimes(1);
    expect(h.processExit).toHaveBeenCalledWith(0);
  });

  it("SIGTERM tambien dispara shutdown", async () => {
    const h = makeHarness();
    await main(h.deps);

    const handler = h.signals.get("SIGTERM")!;
    handler();
    await new Promise((r) => setImmediate(r));

    expect(h.app.stop).toHaveBeenCalledTimes(1);
    expect(h.processExit).toHaveBeenCalledWith(0);
  });

  it("shutdown es idempotente: llamar SIGINT dos veces no duplica stop()", async () => {
    const h = makeHarness();
    await main(h.deps);

    const handler = h.signals.get("SIGINT")!;
    handler();
    handler();
    await new Promise((r) => setImmediate(r));

    expect(h.app.stop).toHaveBeenCalledTimes(1);
  });

  it("config invalida: exit(1) sin componer app ni arrancar server", async () => {
    const h = makeHarness({ configThrows: new Error("config invalida") });
    await main(h.deps);

    expect(h.composeApp).not.toHaveBeenCalled();
    expect(h.startHealthServer).not.toHaveBeenCalled();
    expect(h.processExit).toHaveBeenCalledWith(1);
  });

  it("app.start() rechaza: exit(1) tras cerrar el health server", async () => {
    const boom = new Error("start boom");
    const h = makeHarness({ startThrows: boom });
    await main(h.deps);

    expect(h.app.start).toHaveBeenCalledTimes(1);
    expect((h.server as unknown as { close: ReturnType<typeof vi.fn> }).close)
      .toHaveBeenCalled();
    expect(h.processExit).toHaveBeenCalledWith(1);
  });

  it("devuelve {app, server} en arranque exitoso", async () => {
    const h = makeHarness();
    const result = await main(h.deps);

    expect(result).toBeDefined();
    expect(result).toMatchObject({
      app: h.app,
      server: h.server,
    });
  });

  it("shutdown que falla llama exit(1)", async () => {
    const h = makeHarness();
    h.app.stop = vi.fn(async () => {
      throw new Error("stop boom");
    });
    await main(h.deps);

    const handler = h.signals.get("SIGINT")!;
    handler();
    await new Promise((r) => setImmediate(r));

    expect(h.processExit).toHaveBeenCalledWith(1);
  });
});
