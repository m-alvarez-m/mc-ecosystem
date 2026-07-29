import { describe, it, expect, vi } from "vitest";
import {
  AdvancementHandler,
  MissingAdvancementNameError,
} from "../src/handlers/advancement-handler";
import { MissingPlayerNameError } from "../src/handlers/errors";
import type { DispatchContext } from "../src/context";
import type { Publisher, PublishPayload } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";

// Tests de AdvancementHandler.
// Sin Discord, sin red: publisher fake y contexto minimo.

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

function fakeContext(publisher: Publisher): DispatchContext {
  return { publisher };
}

function advancementEvent(
  data: Record<string, unknown>,
  uuid = "aaaa",
): EventRecord {
  return {
    id: "42",
    event_uuid: `00000000-0000-4000-8000-${uuid.padStart(12, "0")}`,
    type: "player.advancement",
    v: 1,
    ts: "2026-07-27T00:00:00.000Z",
    received_at: "2026-07-27T00:00:00.010Z",
    player_uuid: "71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
    world: "world",
    x: 0,
    y: 64,
    z: 0,
    data,
  };
}

describe("AdvancementHandler", () => {
  it("supports('player.advancement') true; otros false", () => {
    const h = new AdvancementHandler();
    expect(h.supports("player.advancement")).toBe(true);
    expect(h.supports("advancement.done")).toBe(false); // el del catalogo real
    expect(h.supports("player.death")).toBe(false);
    expect(h.supports("")).toBe(false);
    expect(h.supports("PLAYER.ADVANCEMENT")).toBe(false);
  });

  it("publicacion correcta con jugador y avance", async () => {
    const publisher = fakePublisher();
    const h = new AdvancementHandler();
    await h.handle(
      fakeContext(publisher),
      advancementEvent({ name: "Vancorbus", advancement: "Enter the Nether" }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Nuevo avance",
      body: "Vancorbus ha conseguido el avance: Enter the Nether.",
    });
  });

  it("mensaje esperado para varios jugadores/avances", async () => {
    const publisher = fakePublisher();
    const h = new AdvancementHandler();
    await h.handle(
      fakeContext(publisher),
      advancementEvent({ name: "Pacman26", advancement: "Diamonds!" }),
    );
    await h.handle(
      fakeContext(publisher),
      advancementEvent({ name: "Elrid", advancement: "The End?" }),
    );

    expect(publisher.publish.mock.calls[0]![0]).toEqual({
      title: "Nuevo avance",
      body: "Pacman26 ha conseguido el avance: Diamonds!.",
    });
    expect(publisher.publish.mock.calls[1]![0]).toEqual({
      title: "Nuevo avance",
      body: "Elrid ha conseguido el avance: The End?.",
    });
  });

  it("trimea whitespace de nombre y avance", async () => {
    const publisher = fakePublisher();
    const h = new AdvancementHandler();
    await h.handle(
      fakeContext(publisher),
      advancementEvent({ name: "  V  ", advancement: "  Getting an Upgrade  " }),
    );

    expect(publisher.publish).toHaveBeenCalledWith({
      title: "Nuevo avance",
      body: "V ha conseguido el avance: Getting an Upgrade.",
    });
  });

  it("data.name ausente: MissingPlayerNameError y NO publica", async () => {
    const publisher = fakePublisher();
    const h = new AdvancementHandler();

    await expect(
      h.handle(fakeContext(publisher), advancementEvent({ advancement: "X" })),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.name no-string o vacio: MissingPlayerNameError", async () => {
    const publisher = fakePublisher();
    const h = new AdvancementHandler();

    await expect(
      h.handle(
        fakeContext(publisher),
        advancementEvent({ name: 42, advancement: "X" }),
      ),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    await expect(
      h.handle(
        fakeContext(publisher),
        advancementEvent({ name: "  ", advancement: "X" }),
      ),
    ).rejects.toBeInstanceOf(MissingPlayerNameError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.advancement ausente: MissingAdvancementNameError y NO publica", async () => {
    const publisher = fakePublisher();
    const h = new AdvancementHandler();

    await expect(
      h.handle(fakeContext(publisher), advancementEvent({ name: "X" })),
    ).rejects.toBeInstanceOf(MissingAdvancementNameError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.advancement no-string o vacio: MissingAdvancementNameError", async () => {
    const publisher = fakePublisher();
    const h = new AdvancementHandler();

    await expect(
      h.handle(
        fakeContext(publisher),
        advancementEvent({ name: "X", advancement: 42 }),
      ),
    ).rejects.toBeInstanceOf(MissingAdvancementNameError);
    await expect(
      h.handle(
        fakeContext(publisher),
        advancementEvent({ name: "X", advancement: "" }),
      ),
    ).rejects.toBeInstanceOf(MissingAdvancementNameError);
    await expect(
      h.handle(
        fakeContext(publisher),
        advancementEvent({ name: "X", advancement: "   " }),
      ),
    ).rejects.toBeInstanceOf(MissingAdvancementNameError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("errores incluyen event_uuid y mencionan player.advancement", async () => {
    const h = new AdvancementHandler();

    const eventA = advancementEvent({ advancement: "X" }, "aaaa1111aaaa");
    const errA = await h
      .handle(fakeContext(fakePublisher()), eventA)
      .catch((e) => e);
    expect(errA).toBeInstanceOf(MissingPlayerNameError);
    expect((errA as MissingPlayerNameError).eventUuid).toBe(eventA.event_uuid);
    expect((errA as MissingPlayerNameError).message).toContain("player.advancement");

    const eventB = advancementEvent({ name: "V" }, "bbbb2222bbbb");
    const errB = await h
      .handle(fakeContext(fakePublisher()), eventB)
      .catch((e) => e);
    expect(errB).toBeInstanceOf(MissingAdvancementNameError);
    expect((errB as MissingAdvancementNameError).eventUuid).toBe(eventB.event_uuid);
    expect((errB as MissingAdvancementNameError).message).toContain("player.advancement");
  });

  it("publisher llamado exactamente una vez en caso feliz", async () => {
    const publisher = fakePublisher();
    const h = new AdvancementHandler();
    await h.handle(
      fakeContext(publisher),
      advancementEvent({ name: "X", advancement: "Y" }),
    );
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("error del publisher se propaga tal cual", async () => {
    const boom = new Error("publish boom");
    const publisher: Publisher = {
      publish: vi.fn(async () => {
        throw boom;
      }),
    };
    const h = new AdvancementHandler();
    await expect(
      h.handle(
        fakeContext(publisher),
        advancementEvent({ name: "X", advancement: "Y" }),
      ),
    ).rejects.toBe(boom);
  });

  it("funciona con cualquier Publisher fake (no depende de Discord)", async () => {
    const seen: PublishPayload[] = [];
    const publisher: Publisher = {
      publish: async (p) => {
        seen.push(p);
      },
    };
    const h = new AdvancementHandler();
    await h.handle(
      fakeContext(publisher),
      advancementEvent({ name: "Vancorbus", advancement: "Enter the Nether" }),
    );
    expect(seen).toEqual([
      {
        title: "Nuevo avance",
        body: "Vancorbus ha conseguido el avance: Enter the Nether.",
      },
    ]);
  });
});
