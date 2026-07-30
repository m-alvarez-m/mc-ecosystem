import { describe, it, expect, vi } from "vitest";
import { TpsHandler, InvalidTpsError } from "../src/handlers/tps-handler";
import type { DispatchContext } from "../src/context";
import type { Publisher, PublishPayload } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";

// Tests de TpsHandler (T2 v1.1).
// Sin Discord, sin red: publisher fake y contexto minimo.
//
// Semantica: publica sólo si tps < alertThreshold. Sample sano
// (tps >= umbral) → silencio absoluto.

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

const NEVER_CALLED_RESOLVER = {
  resolve: vi.fn(async () => {
    throw new Error("PlayerNameResolver no debe usarse en server.tps_sample");
  }),
} as unknown as import("../src/players").PlayerNameResolver;

function fakeContext(publisher: Publisher): DispatchContext {
  return { publisher, playerNameResolver: NEVER_CALLED_RESOLVER };
}

function tpsEvent(data: Record<string, unknown>, uuid = "aaaa"): EventRecord {
  return {
    id: "42",
    event_uuid: `00000000-0000-4000-8000-${uuid.padStart(12, "0")}`,
    type: "server.tps_sample",
    v: 1,
    ts: "2026-07-27T00:00:00.000Z",
    received_at: "2026-07-27T00:00:00.010Z",
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data,
  };
}

describe("TpsHandler", () => {
  it("supports('server.tps_sample') true; otros false", () => {
    const h = new TpsHandler({ alertThreshold: 18 });
    expect(h.supports("server.tps_sample")).toBe(true);
    expect(h.supports("server.start")).toBe(false);
    expect(h.supports("session.start")).toBe(false);
    expect(h.supports("")).toBe(false);
    expect(h.supports("SERVER.TPS_SAMPLE")).toBe(false);
  });

  // ---------- umbral ----------

  it("TPS estrictamente superior al umbral: NO publica", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler({ alertThreshold: 18 });
    await h.handle(fakeContext(publisher), tpsEvent({ tps_1m: 19.85 }));
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("TPS exactamente igual al umbral: NO publica (>= umbral es silencio)", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler({ alertThreshold: 18 });
    await h.handle(fakeContext(publisher), tpsEvent({ tps_1m: 18 }));
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("TPS igual al umbral con decimales (18.0 vs 18): NO publica", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler({ alertThreshold: 18 });
    await h.handle(fakeContext(publisher), tpsEvent({ tps_1m: 18.0 }));
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("TPS estrictamente inferior al umbral: publica alerta", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler({ alertThreshold: 18 });
    await h.handle(fakeContext(publisher), tpsEvent({ tps_1m: 15 }));

    expect(publisher.publish).toHaveBeenCalledOnce();
    const call = publisher.publish.mock.calls[0]![0] as PublishPayload;
    expect(call.title).toBe("Rendimiento degradado");
    // El body debe reflejar el TPS medido Y el umbral configurado.
    expect(call.body).toContain("15");
    expect(call.body).toContain("18");
  });

  it("el mensaje comunica claramente que hay degradación (nada de 'TPS actual')", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler({ alertThreshold: 18 });
    await h.handle(fakeContext(publisher), tpsEvent({ tps_1m: 12 }));

    const call = publisher.publish.mock.calls[0]![0] as PublishPayload;
    expect(call.title).toBe("Rendimiento degradado");
    expect(call.body).not.toContain("TPS actual");
    // Palabra clave que indica problema:
    expect(call.body.toLowerCase()).toMatch(/lento|degradad|bajo/);
  });

  it("valores decimales: TPS 17.99 con umbral 18 publica; TPS 18.01 no", async () => {
    const publisher1 = fakePublisher();
    const h1 = new TpsHandler({ alertThreshold: 18 });
    await h1.handle(fakeContext(publisher1), tpsEvent({ tps_1m: 17.99 }));
    expect(publisher1.publish).toHaveBeenCalledOnce();

    const publisher2 = fakePublisher();
    const h2 = new TpsHandler({ alertThreshold: 18 });
    await h2.handle(fakeContext(publisher2), tpsEvent({ tps_1m: 18.01 }));
    expect(publisher2.publish).not.toHaveBeenCalled();
  });

  it("umbral custom (15): TPS 16 no publica, TPS 14 sí publica", async () => {
    const publisher1 = fakePublisher();
    const h1 = new TpsHandler({ alertThreshold: 15 });
    await h1.handle(fakeContext(publisher1), tpsEvent({ tps_1m: 16 }));
    expect(publisher1.publish).not.toHaveBeenCalled();

    const publisher2 = fakePublisher();
    const h2 = new TpsHandler({ alertThreshold: 15 });
    await h2.handle(fakeContext(publisher2), tpsEvent({ tps_1m: 14 }));
    expect(publisher2.publish).toHaveBeenCalledOnce();
    expect((publisher2.publish.mock.calls[0]![0] as PublishPayload).body).toContain(
      "15",
    );
  });

  it("umbral decimal (17.5): TPS 17.6 no publica, TPS 17.4 sí publica", async () => {
    const publisher1 = fakePublisher();
    const h1 = new TpsHandler({ alertThreshold: 17.5 });
    await h1.handle(fakeContext(publisher1), tpsEvent({ tps_1m: 17.6 }));
    expect(publisher1.publish).not.toHaveBeenCalled();

    const publisher2 = fakePublisher();
    const h2 = new TpsHandler({ alertThreshold: 17.5 });
    await h2.handle(fakeContext(publisher2), tpsEvent({ tps_1m: 17.4 }));
    expect(publisher2.publish).toHaveBeenCalledOnce();
    expect((publisher2.publish.mock.calls[0]![0] as PublishPayload).body).toContain(
      "17.5",
    );
  });

  it("TPS cero: publica (0 < cualquier umbral positivo)", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler({ alertThreshold: 18 });
    await h.handle(fakeContext(publisher), tpsEvent({ tps_1m: 0 }));
    expect(publisher.publish).toHaveBeenCalledOnce();
  });

  it("TPS negativo: publica (raro, pero < umbral)", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler({ alertThreshold: 18 });
    await h.handle(fakeContext(publisher), tpsEvent({ tps_1m: -1.5 }));
    expect(publisher.publish).toHaveBeenCalledOnce();
  });

  // ---------- validación del payload ----------

  it("data.tps_1m ausente: InvalidTpsError y NO publica", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler({ alertThreshold: 18 });

    await expect(
      h.handle(fakeContext(publisher), tpsEvent({})),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.tps_1m no numerico: InvalidTpsError", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler({ alertThreshold: 18 });

    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps_1m: "20" })),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps_1m: null })),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps_1m: true })),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps_1m: [20] })),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.tps_1m NaN o Infinity: InvalidTpsError", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler({ alertThreshold: 18 });

    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps_1m: Number.NaN })),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps_1m: Number.POSITIVE_INFINITY })),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps_1m: Number.NEGATIVE_INFINITY })),
    ).rejects.toBeInstanceOf(InvalidTpsError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("InvalidTpsError incluye event_uuid y menciona server.tps_sample", async () => {
    const h = new TpsHandler({ alertThreshold: 18 });
    const event = tpsEvent({}, "cafecafecafe");
    const err = await h
      .handle(fakeContext(fakePublisher()), event)
      .catch((e) => e);
    expect(err).toBeInstanceOf(InvalidTpsError);
    expect((err as InvalidTpsError).eventUuid).toBe(event.event_uuid);
    expect((err as InvalidTpsError).code).toBe("INVALID_TPS");
    expect((err as InvalidTpsError).message).toContain("server.tps_sample");
  });

  // ---------- integración con publisher ----------

  it("publisher llamado exactamente una vez cuando hay alerta", async () => {
    const publisher = fakePublisher();
    const h = new TpsHandler({ alertThreshold: 18 });
    await h.handle(fakeContext(publisher), tpsEvent({ tps_1m: 10 }));
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("error del publisher se propaga tal cual", async () => {
    const boom = new Error("publish boom");
    const publisher: Publisher = {
      publish: vi.fn(async () => {
        throw boom;
      }),
    };
    const h = new TpsHandler({ alertThreshold: 18 });
    await expect(
      h.handle(fakeContext(publisher), tpsEvent({ tps_1m: 5 })),
    ).rejects.toBe(boom);
  });

  it("funciona con cualquier Publisher fake (no depende de Discord)", async () => {
    const seen: PublishPayload[] = [];
    const publisher: Publisher = {
      publish: async (p) => {
        seen.push(p);
      },
    };
    const h = new TpsHandler({ alertThreshold: 18 });
    await h.handle(fakeContext(publisher), tpsEvent({ tps_1m: 12.5 }));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.title).toBe("Rendimiento degradado");
    expect(seen[0]!.body).toContain("12.5");
    expect(seen[0]!.body).toContain("18");
  });
});
