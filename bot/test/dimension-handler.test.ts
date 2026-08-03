import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DimensionHandler,
  MissingDimensionError,
} from "../src/handlers/dimension-handler";
import { MissingPlayerUuidError } from "../src/handlers/errors";
import type { DispatchContext } from "../src/context";
import type { Publisher } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";
import {
  PlayerNameResolver,
  PlayerNotFoundError,
  PlayerLookupHttpError,
} from "../src/players";

// Tests de DimensionHandler (T9 · Dimension Chronicle).
//
// El handler ya deduplica por (uuid, dimensión) EN MEMORIA por
// instancia. Los tests verifican:
//   - primera entrada por dimensión publica;
//   - re-entradas del mismo jugador a la misma dimensión NO publican;
//   - jugadores diferentes tienen historial independiente;
//   - dimensiones distintas del mismo jugador publican por separado;
//   - selección aleatoria delegada al catálogo;
//   - dimensión desconocida cae al fallback genérico del catálogo;
//   - payload sin player_uuid o sin data.dimension lanza errores
//     tipados sin publicar.
//
// Cero acoplamiento a texto literal salvo para el fallback (patrón
// fijo del catálogo).

function fakePublisher(): Publisher & { publish: ReturnType<typeof vi.fn> } {
  return { publish: vi.fn(async () => undefined) };
}

function fakeResolverFromMap(
  map: Record<string, string>,
): PlayerNameResolver & { resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn(async (uuid: string) => {
    if (uuid in map) return map[uuid]!;
    throw new PlayerNotFoundError(uuid);
  });
  return { resolve } as unknown as PlayerNameResolver & {
    resolve: ReturnType<typeof vi.fn>;
  };
}

function fakeContext(
  publisher: Publisher,
  resolver: PlayerNameResolver,
): DispatchContext {
  return { publisher, playerNameResolver: resolver, logger: { warn: () => undefined }, freshnessThresholdMs: 120000,
      lifecycleState: { get: () => "unknown" as const, set: () => undefined }, lifecycleState: { get: () => "unknown", set: () => undefined } };
}

const MIGUEL = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";
const VANCORBUS = "9d3a0000-0000-4000-8000-000000000abc";

function dimensionEvent(
  overrides: {
    playerUuid?: string | null;
    eventUuid?: string;
    id?: string;
    data?: Record<string, unknown>;
  } = {},
): EventRecord {
  return {
    id: overrides.id ?? "42",
    event_uuid: overrides.eventUuid ?? "00000000-0000-4000-8000-000000000001",
    type: "dimension.enter",
    v: 1,
    ts: "2026-07-30T00:00:00.000Z",
    received_at: "2026-07-30T00:00:00.010Z",
    player_uuid: overrides.playerUuid === undefined ? MIGUEL : overrides.playerUuid,
    world: "world",
    x: 0,
    y: 64,
    z: 0,
    data: overrides.data ?? { dimension: "overworld" },
  };
}

/** Fuerza determinismo: primera variante siempre. */
function stubRandomToFirstVariant(): void {
  vi.spyOn(Math, "random").mockReturnValue(0);
}

/** Corre el handler y devuelve el body publicado (asume una publicación). */
async function bodyOf(
  handler: DimensionHandler,
  event: EventRecord,
  map: Record<string, string> = { [MIGUEL]: "Miguel" },
): Promise<string> {
  const publisher = fakePublisher();
  const context = fakeContext(publisher, fakeResolverFromMap(map));
  await handler.handle(context, event);
  const call = publisher.publish.mock.calls[0]!;
  return call[0].body as string;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// -------------------------------------------------------------------
// Shape básico
// -------------------------------------------------------------------

describe("DimensionHandler · shape", () => {
  it("supports('dimension.enter') = true", () => {
    expect(new DimensionHandler().supports("dimension.enter")).toBe(true);
  });

  it("supports() de cualquier otro tipo = false", () => {
    const h = new DimensionHandler();
    expect(h.supports("player.death")).toBe(false);
    expect(h.supports("session.start")).toBe(false);
    expect(h.supports("dimension.exit")).toBe(false);
  });

  it("publica title y kind acordados", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );
    await new DimensionHandler().handle(context, dimensionEvent());
    const call = publisher.publish.mock.calls[0]![0];
    expect(call.title).toBe("Nueva dimensión");
    expect(call.kind).toBe("dimension_first_enter");
    expect(typeof call.body).toBe("string");
    expect((call.body as string).length).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------
// Primeras entradas — publican por dimensión
// -------------------------------------------------------------------

describe("DimensionHandler · primera entrada por dimensión", () => {
  it("primera entrada al Overworld → publica", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(
      new DimensionHandler(),
      dimensionEvent({ data: { dimension: "overworld" } }),
    );
    expect(body).toMatch(/🌍/);
    expect(body).toContain("Miguel");
  });

  it("primera entrada al Nether → publica", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(
      new DimensionHandler(),
      dimensionEvent({ data: { dimension: "the_nether" } }),
    );
    expect(body).toMatch(/🔥/);
    expect(body).toContain("Miguel");
  });

  it("primera entrada al End → publica", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(
      new DimensionHandler(),
      dimensionEvent({ data: { dimension: "the_end" } }),
    );
    expect(body).toMatch(/👁/);
    expect(body).toContain("Miguel");
  });
});

// -------------------------------------------------------------------
// Deduplicación
// -------------------------------------------------------------------

describe("DimensionHandler · deduplicación", () => {
  it("mismo jugador + misma dimensión: la 2ª y 3ª entrada NO publican", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );
    const handler = new DimensionHandler();

    await handler.handle(context, dimensionEvent({ eventUuid: "e1" }));
    await handler.handle(context, dimensionEvent({ eventUuid: "e2" }));
    await handler.handle(context, dimensionEvent({ eventUuid: "e3" }));

    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("mismo jugador entrando a dimensiones distintas: cada una publica una vez", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );
    const handler = new DimensionHandler();

    // Overworld (nuevo), Nether (nuevo), Overworld (repetido),
    // End (nuevo), Nether (repetido).
    await handler.handle(context, dimensionEvent({ data: { dimension: "overworld" } }));
    await handler.handle(context, dimensionEvent({ data: { dimension: "the_nether" } }));
    await handler.handle(context, dimensionEvent({ data: { dimension: "overworld" } }));
    await handler.handle(context, dimensionEvent({ data: { dimension: "the_end" } }));
    await handler.handle(context, dimensionEvent({ data: { dimension: "the_nether" } }));

    expect(publisher.publish).toHaveBeenCalledTimes(3);
  });

  it("dedup también aplica a dimensiones desconocidas (mundo custom)", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );
    const handler = new DimensionHandler();

    await handler.handle(
      context,
      dimensionEvent({ data: { dimension: "arena_ki" } }),
    );
    await handler.handle(
      context,
      dimensionEvent({ data: { dimension: "arena_ki" } }),
    );

    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------------
// Historial independiente por jugador
// -------------------------------------------------------------------

describe("DimensionHandler · aislamiento por jugador", () => {
  it("dos jugadores distintos: cada uno tiene su propio historial", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel", [VANCORBUS]: "Vancorbus" }),
    );
    const handler = new DimensionHandler();

    // Miguel entra al Nether → publica.
    await handler.handle(
      context,
      dimensionEvent({
        playerUuid: MIGUEL,
        data: { dimension: "the_nether" },
      }),
    );
    // Miguel vuelve al Nether → NO publica.
    await handler.handle(
      context,
      dimensionEvent({
        playerUuid: MIGUEL,
        data: { dimension: "the_nether" },
      }),
    );
    // Vancorbus entra al Nether por primera vez → SÍ publica
    // (historial independiente).
    await handler.handle(
      context,
      dimensionEvent({
        playerUuid: VANCORBUS,
        data: { dimension: "the_nether" },
      }),
    );

    expect(publisher.publish).toHaveBeenCalledTimes(2);
  });

  it("instancias distintas del handler NO comparten estado (memoria por instancia)", async () => {
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );

    const h1 = new DimensionHandler();
    const h2 = new DimensionHandler();

    await h1.handle(context, dimensionEvent());
    await h2.handle(context, dimensionEvent());

    // Como son handlers distintos, cada uno cuenta su primera entrada.
    expect(publisher.publish).toHaveBeenCalledTimes(2);
  });
});

// -------------------------------------------------------------------
// Selección aleatoria (delega en el catálogo)
// -------------------------------------------------------------------

describe("DimensionHandler · selección aleatoria", () => {
  it("Math.random varía → body varía dentro de la pool de esa dimensión", async () => {
    const seen = new Set<string>();
    // Instancia POR VALOR — cada valor de random necesita un handler
    // limpio, si no la dedup nos come a partir del 2º intento.
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      const body = await bodyOf(
        new DimensionHandler(),
        dimensionEvent({ data: { dimension: "overworld" } }),
      );
      seen.add(body);
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

// -------------------------------------------------------------------
// Fallback dimensión desconocida
// -------------------------------------------------------------------

describe("DimensionHandler · dimensión desconocida", () => {
  it("mundo custom del servidor: publica fallback genérico con el nombre crudo", async () => {
    const body = await bodyOf(
      new DimensionHandler(),
      dimensionEvent({ data: { dimension: "world_creative" } }),
    );
    expect(body).toBe("🌐 Miguel descubrió un nuevo mundo: world_creative.");
  });
});

// -------------------------------------------------------------------
// Errores tipados — no publicar payloads incoherentes
// -------------------------------------------------------------------

describe("DimensionHandler · errores tipados", () => {
  it("player_uuid null → MissingPlayerUuidError, no publica", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );
    await expect(
      new DimensionHandler().handle(
        context,
        dimensionEvent({ playerUuid: null }),
      ),
    ).rejects.toBeInstanceOf(MissingPlayerUuidError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.dimension ausente → MissingDimensionError, no publica", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );
    await expect(
      new DimensionHandler().handle(context, dimensionEvent({ data: {} })),
    ).rejects.toBeInstanceOf(MissingDimensionError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.dimension no-string → MissingDimensionError, no publica", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );
    await expect(
      new DimensionHandler().handle(
        context,
        dimensionEvent({ data: { dimension: 42 } }),
      ),
    ).rejects.toBeInstanceOf(MissingDimensionError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("data.dimension string vacío → MissingDimensionError, no publica", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );
    await expect(
      new DimensionHandler().handle(
        context,
        dimensionEvent({ data: { dimension: "   " } }),
      ),
    ).rejects.toBeInstanceOf(MissingDimensionError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("dedup NO se activa si el handler lanzó antes de marcar", async () => {
    // Una entrada con dimensión vacía lanza; una posterior VÁLIDA
    // debe publicarse (porque el intento fallido no dejó rastro).
    stubRandomToFirstVariant();
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );
    const handler = new DimensionHandler();

    await handler
      .handle(context, dimensionEvent({ data: {} }))
      .catch(() => undefined);
    await handler.handle(
      context,
      dimensionEvent({ data: { dimension: "overworld" } }),
    );

    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("PlayerNotFoundError del resolver se propaga", async () => {
    const publisher = fakePublisher();
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({}), // sin Miguel → resolver lanza
    );
    await expect(
      new DimensionHandler().handle(context, dimensionEvent()),
    ).rejects.toBeInstanceOf(PlayerNotFoundError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("PlayerLookupHttpError del resolver se propaga", async () => {
    const publisher = fakePublisher();
    const resolve = vi.fn(async () => {
      throw new PlayerLookupHttpError(MIGUEL, 500, "boom");
    });
    const resolver = { resolve } as unknown as PlayerNameResolver;
    const context = fakeContext(publisher, resolver);

    await expect(
      new DimensionHandler().handle(context, dimensionEvent()),
    ).rejects.toBeInstanceOf(PlayerLookupHttpError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("errores del publisher se propagan (dispatcher los tratará)", async () => {
    stubRandomToFirstVariant();
    const publisher: Publisher & { publish: ReturnType<typeof vi.fn> } = {
      publish: vi.fn(async () => {
        throw new Error("discord caido");
      }),
    };
    const context = fakeContext(
      publisher,
      fakeResolverFromMap({ [MIGUEL]: "Miguel" }),
    );

    await expect(
      new DimensionHandler().handle(context, dimensionEvent()),
    ).rejects.toThrow(/discord caido/);
  });
});
