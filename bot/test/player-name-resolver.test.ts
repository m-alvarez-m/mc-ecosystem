import { describe, it, expect, vi } from "vitest";
import { PlayerNameResolver } from "../src/players/player-name-resolver";
import {
  PlayerLookupHttpError,
  PlayerLookupInvalidJsonError,
  PlayerLookupNetworkError,
  PlayerLookupTimeoutError,
  PlayerLookupUnexpectedResponseError,
  PlayerNotFoundError,
} from "../src/players/errors";
import { ChatHandler } from "../src/handlers/chat-handler";
import { PlayerJoinedHandler } from "../src/handlers/player-joined-handler";
import type { EventRecord } from "../src/eventstore";
import type { DispatchContext } from "../src/context";

// Tests de PlayerNameResolver.
//
// El fetch se inyecta via options. Cero red real, cero mock global.

const BASE_URL = "http://api:3000";
const TIMEOUT = 5_000;
const UUID_A = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";
const UUID_B = "8a80a72d-fb01-3e17-9a96-2b801d16f82d";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchReturning(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

// Fetch que nunca resuelve por si mismo pero respeta AbortSignal.
function fetchHanging(): typeof fetch {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | null;
        if (signal) {
          const onAbort = (): void => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }
      }),
  ) as unknown as typeof fetch;
}

describe("PlayerNameResolver.resolve", () => {
  it("primer lookup: realiza HTTP GET a /players/:uuid y devuelve name", async () => {
    const spy = vi.fn(async () =>
      jsonResponse({ uuid: UUID_A, name: "Vancorbus", first_seen: "x", last_seen: "y" }),
    );
    const resolver = new PlayerNameResolver({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: spy as unknown as typeof fetch,
    });

    const name = await resolver.resolve(UUID_A);

    expect(name).toBe("Vancorbus");
    expect(spy).toHaveBeenCalledTimes(1);
    const calledUrl = String(spy.mock.calls[0]![0]);
    expect(calledUrl).toBe(`${BASE_URL}/players/${UUID_A}`);
  });

  it("segundo lookup del mismo uuid: usa cache, cero HTTP adicional", async () => {
    const spy = vi.fn(async () =>
      jsonResponse({ uuid: UUID_A, name: "Vancorbus", first_seen: "x", last_seen: "y" }),
    );
    const resolver = new PlayerNameResolver({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: spy as unknown as typeof fetch,
    });

    const a = await resolver.resolve(UUID_A);
    const b = await resolver.resolve(UUID_A);
    const c = await resolver.resolve(UUID_A);

    expect(a).toBe("Vancorbus");
    expect(b).toBe("Vancorbus");
    expect(c).toBe("Vancorbus");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("uuids distintos: cada uno dispara UN HTTP; cada uno cachea por separado", async () => {
    const spy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(UUID_A))
        return jsonResponse({ uuid: UUID_A, name: "Vancorbus", first_seen: "x", last_seen: "y" });
      if (url.endsWith(UUID_B))
        return jsonResponse({ uuid: UUID_B, name: "Elrid", first_seen: "x", last_seen: "y" });
      throw new Error(`unexpected url ${url}`);
    });
    const resolver = new PlayerNameResolver({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: spy as unknown as typeof fetch,
    });

    // Interleave para probar que la cache no confunde uuids.
    expect(await resolver.resolve(UUID_A)).toBe("Vancorbus");
    expect(await resolver.resolve(UUID_B)).toBe("Elrid");
    expect(await resolver.resolve(UUID_A)).toBe("Vancorbus");
    expect(await resolver.resolve(UUID_B)).toBe("Elrid");
    expect(await resolver.resolve(UUID_A)).toBe("Vancorbus");

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("dos handlers comparten el MISMO resolver → cero HTTP redundante entre ellos", async () => {
    // Verificacion clave del contrato de la Etapa 4: la resolucion
    // es un UNICO componente compartido. Un handler resuelve → cache.
    // Otro handler distinto pide el mismo uuid → cache hit, cero
    // HTTP nuevo.
    const spy = vi.fn(async () =>
      jsonResponse({ uuid: UUID_A, name: "Vancorbus", first_seen: "x", last_seen: "y" }),
    );
    const resolver = new PlayerNameResolver({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: spy as unknown as typeof fetch,
    });

    const seen: Array<{ title: string; body: string }> = [];
    const context: DispatchContext = {
      publisher: {
        publish: async (p) => {
          seen.push(p);
        },
      },
      playerNameResolver: resolver,
      logger: { warn: () => undefined },
      freshnessThresholdMs: 120000,
      lifecycleState: { get: () => "unknown" as const, set: () => undefined },
    };

    const chatEvent: EventRecord = {
      id: "1",
      event_uuid: "00000000-0000-4000-8000-000000000001",
      type: "chat.message",
      v: 1,
      ts: "2026-07-27T00:00:00.000Z",
      received_at: "2026-07-27T00:00:00.010Z",
      player_uuid: UUID_A,
      world: null,
      x: null,
      y: null,
      z: null,
      data: { content: "hola" },
    };
    const joinEvent: EventRecord = {
      ...chatEvent,
      id: "2",
      event_uuid: "00000000-0000-4000-8000-000000000002",
      type: "session.start",
      data: { ip_hash: "abcd" },
    };

    await new ChatHandler().handle(context, chatEvent);
    await new PlayerJoinedHandler().handle(context, joinEvent);

    expect(seen).toEqual([
      { title: "Chat", body: "Vancorbus: hola", kind: "chat" },
      { title: "Jugador conectado", body: "Vancorbus se ha unido al servidor.", kind: "player_joined" },
    ]);
    // Punto clave: el segundo handler NO dispara HTTP adicional.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("404: lanza PlayerNotFoundError con el uuid; NO cachea la ausencia (proximo lookup vuelve a hacer HTTP)", async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(
        jsonResponse({ uuid: UUID_A, name: "Vancorbus", first_seen: "x", last_seen: "y" }),
      );
    const resolver = new PlayerNameResolver({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: spy as unknown as typeof fetch,
    });

    // Primer lookup: 404 propagado.
    const err = await resolver.resolve(UUID_A).catch((e) => e);
    expect(err).toBeInstanceOf(PlayerNotFoundError);
    expect((err as PlayerNotFoundError).uuid).toBe(UUID_A);
    expect((err as PlayerNotFoundError).code).toBe("PLAYER_NOT_FOUND");

    // Segundo lookup: NO cachea negativo → vuelve a intentar y
    // esta vez el api responde con la identidad recien creada.
    const name = await resolver.resolve(UUID_A);
    expect(name).toBe("Vancorbus");

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("500 (HTTP no exitoso distinto de 404): lanza PlayerLookupHttpError con status y body", async () => {
    const spy = fetchReturning(new Response("internal boom", { status: 500 }));
    const resolver = new PlayerNameResolver({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: spy,
    });

    const err = await resolver.resolve(UUID_A).catch((e) => e);
    expect(err).toBeInstanceOf(PlayerLookupHttpError);
    expect((err as PlayerLookupHttpError).status).toBe(500);
    expect((err as PlayerLookupHttpError).body).toBe("internal boom");
    expect((err as PlayerLookupHttpError).code).toBe("HTTP");
    expect((err as PlayerLookupHttpError).uuid).toBe(UUID_A);
  });

  it("timeout: lanza PlayerLookupTimeoutError", async () => {
    const resolver = new PlayerNameResolver({
      baseUrl: BASE_URL,
      timeoutMs: 50,
      fetch: fetchHanging(),
    });

    const err = await resolver.resolve(UUID_A).catch((e) => e);
    expect(err).toBeInstanceOf(PlayerLookupTimeoutError);
    expect((err as PlayerLookupTimeoutError).uuid).toBe(UUID_A);
    expect((err as PlayerLookupTimeoutError).code).toBe("TIMEOUT");
  });

  it("network error: lanza PlayerLookupNetworkError con causa preservada", async () => {
    const original = new Error("ECONNREFUSED 127.0.0.1:3000");
    const spy = vi.fn(async () => {
      throw original;
    }) as unknown as typeof fetch;
    const resolver = new PlayerNameResolver({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: spy,
    });

    const err = await resolver.resolve(UUID_A).catch((e) => e);
    expect(err).toBeInstanceOf(PlayerLookupNetworkError);
    expect((err as PlayerLookupNetworkError).cause).toBe(original);
    expect((err as PlayerLookupNetworkError).code).toBe("NETWORK");
  });

  it("respuesta con JSON invalido: lanza PlayerLookupInvalidJsonError", async () => {
    const spy = fetchReturning(
      new Response("no soy json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const resolver = new PlayerNameResolver({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: spy,
    });

    const err = await resolver.resolve(UUID_A).catch((e) => e);
    expect(err).toBeInstanceOf(PlayerLookupInvalidJsonError);
    expect((err as PlayerLookupInvalidJsonError).code).toBe("INVALID_JSON");
  });

  it("respuesta con shape incorrecto (sin campo name): lanza PlayerLookupUnexpectedResponseError", async () => {
    const spy = fetchReturning(jsonResponse({ uuid: UUID_A, notName: "x" }));
    const resolver = new PlayerNameResolver({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: spy,
    });

    const err = await resolver.resolve(UUID_A).catch((e) => e);
    expect(err).toBeInstanceOf(PlayerLookupUnexpectedResponseError);
    expect((err as PlayerLookupUnexpectedResponseError).code).toBe("UNEXPECTED_RESPONSE");
  });

  it("errores NO cachean: reintentos posteriores hacen HTTP de nuevo", async () => {
    // Timeout primero, luego respuesta ok. El segundo lookup debe
    // volver a intentar (no hay cache negativo).
    const spy = vi
      .fn()
      .mockImplementationOnce(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal as AbortSignal | null;
            if (signal) {
              const onAbort = (): void => {
                const err = new Error("Aborted");
                err.name = "AbortError";
                reject(err);
              };
              if (signal.aborted) onAbort();
              else signal.addEventListener("abort", onAbort, { once: true });
            }
          }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ uuid: UUID_A, name: "Vancorbus", first_seen: "x", last_seen: "y" }),
      );
    const resolver = new PlayerNameResolver({
      baseUrl: BASE_URL,
      timeoutMs: 50,
      fetch: spy as unknown as typeof fetch,
    });

    await expect(resolver.resolve(UUID_A)).rejects.toBeInstanceOf(
      PlayerLookupTimeoutError,
    );
    const name = await resolver.resolve(UUID_A);
    expect(name).toBe("Vancorbus");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
