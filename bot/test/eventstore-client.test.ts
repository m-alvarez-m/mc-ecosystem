import { describe, it, expect, vi } from "vitest";
import { EventStoreClient } from "../src/eventstore/client";
import {
  HttpError,
  InvalidJsonError,
  NetworkError,
  TimeoutError,
  UnexpectedResponseError,
} from "../src/eventstore/errors";
import type { EventRecord } from "../src/eventstore/types";

// Tests del cliente HTTP del Event Store.
// El fetch se inyecta via options: cero red real, cero mock global.

const BASE_URL = "http://api:3000";
const TIMEOUT = 5_000;

// Evento minimo valido para las respuestas fake.
const sampleEvent: EventRecord = {
  id: "42",
  event_uuid: "00000000-0000-4000-8000-000000000001",
  type: "session.start",
  v: 1,
  ts: "2026-07-27T00:00:00.000Z",
  received_at: "2026-07-27T00:00:00.010Z",
  player_uuid: "71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
  world: "world",
  x: 0,
  y: 64,
  z: 0,
  data: { ip_hash: "abc" },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchReturning(response: Response): typeof fetch {
  return vi.fn(async () => response) as unknown as typeof fetch;
}

function fetchThrowing(err: Error): typeof fetch {
  return vi.fn(async () => {
    throw err;
  }) as unknown as typeof fetch;
}

// Fetch que nunca resuelve por si mismo pero respeta AbortSignal.
// Simula una api que se ha quedado colgada.
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

describe("EventStoreClient.getEvents", () => {
  it("respuesta correcta: devuelve eventos tipados y last_id", async () => {
    const client = new EventStoreClient({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: fetchReturning(jsonResponse({ events: [sampleEvent], last_id: "42" })),
    });

    const result = await client.getEvents({ after_id: "0", limit: 100 });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.id).toBe("42");
    expect(result.events[0]!.type).toBe("session.start");
    expect(result.last_id).toBe("42");
  });

  it("respuesta vacia: eventos [] y last_id null", async () => {
    const client = new EventStoreClient({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: fetchReturning(jsonResponse({ events: [], last_id: null })),
    });

    const result = await client.getEvents();
    expect(result.events).toHaveLength(0);
    expect(result.last_id).toBeNull();
  });

  it("serializa params: after_id, limit y types en la query string", async () => {
    const spy = vi.fn(async () => jsonResponse({ events: [], last_id: null }));
    const client = new EventStoreClient({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: spy as unknown as typeof fetch,
    });

    await client.getEvents({
      after_id: "100",
      limit: 50,
      types: ["session.start", "block.break"],
    });

    const calledUrl = String(spy.mock.calls[0]![0]);
    expect(calledUrl).toContain("/events");
    expect(calledUrl).toContain("after_id=100");
    expect(calledUrl).toContain("limit=50");
    // El coma se URL-encodea como %2C.
    expect(calledUrl).toContain("types=session.start%2Cblock.break");
  });

  it("timeout: lanza TimeoutError cuando la api no responde", async () => {
    const client = new EventStoreClient({
      baseUrl: BASE_URL,
      timeoutMs: 50,
      fetch: fetchHanging(),
    });

    await expect(client.getEvents()).rejects.toBeInstanceOf(TimeoutError);
  });

  it("HTTP 500: lanza HttpError con status y body", async () => {
    const client = new EventStoreClient({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: fetchReturning(new Response("internal boom", { status: 500 })),
    });

    const err = await client.getEvents().catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(500);
    expect((err as HttpError).body).toBe("internal boom");
  });

  it("JSON invalido: lanza InvalidJsonError", async () => {
    const client = new EventStoreClient({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: fetchReturning(
        new Response("no soy json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    });

    await expect(client.getEvents()).rejects.toBeInstanceOf(InvalidJsonError);
  });

  it("respuesta con schema inesperado: lanza UnexpectedResponseError", async () => {
    const client = new EventStoreClient({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: fetchReturning(jsonResponse({ wrong: "shape" })),
    });

    await expect(client.getEvents()).rejects.toBeInstanceOf(UnexpectedResponseError);
  });

  it("error de conexion: lanza NetworkError con causa", async () => {
    const originalError = new Error("ECONNREFUSED 127.0.0.1:3000");
    const client = new EventStoreClient({
      baseUrl: BASE_URL,
      timeoutMs: TIMEOUT,
      fetch: fetchThrowing(originalError),
    });

    const err = await client.getEvents().catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).cause).toBe(originalError);
  });
});
