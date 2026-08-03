import { describe, it, expect, vi, afterEach } from "vitest";
import { PlayerDeathHandler } from "../src/handlers/player-death-handler";
import { MissingPlayerUuidError } from "../src/handlers/errors";
import type { DispatchContext } from "../src/context";
import type { Publisher } from "../src/publisher";
import type { EventRecord } from "../src/eventstore";
import {
  PlayerNameResolver,
  PlayerNotFoundError,
  PlayerLookupHttpError,
} from "../src/players";

// Tests de PlayerDeathHandler (post T8 · Death Chronicle).
//
// El handler ya no interpola texto propio; delega en el catalogo
// `narrateDeath`. Los tests verifican:
//   - que arma el input correcto para el catalogo (playerName +
//     cause + killer_mob + vanilla message);
//   - que publica title="Crónica de muerte" + kind="player_death";
//   - que el body pertenece a la categoría esperada (comprobado con
//     Math.random spied a valor conocido para elegir la primera
//     variante determinísticamente);
//   - que ante causa desconocida cae al vanillaMessage.
//
// Cero acoplamiento a texto literal de variantes: comprobamos
// pertenencia a la pool (`toContain` sobre palabras clave) para
// permitir que la paleta narrativa evolucione sin romper tests.

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

const VANCORBUS = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";

function playerDeathEvent(
  overrides: {
    playerUuid?: string | null;
    eventUuid?: string;
    data?: Record<string, unknown>;
  } = {},
): EventRecord {
  return {
    id: "42",
    event_uuid: overrides.eventUuid ?? "00000000-0000-4000-8000-000000000001",
    type: "player.death",
    v: 1,
    ts: "2026-07-27T00:00:00.000Z",
    received_at: "2026-07-27T00:00:00.010Z",
    player_uuid: overrides.playerUuid === undefined ? VANCORBUS : overrides.playerUuid,
    world: "world",
    x: 0,
    y: 64,
    z: 0,
    data: overrides.data ?? { cause: "entity_explosion", killer_mob: "minecraft:creeper", message: "Vancorbus was blown up" },
  };
}

// Fija Math.random para elegir siempre la primera variante y
// permitir aserciones deterministas del body.
function stubRandomToFirstVariant(): void {
  vi.spyOn(Math, "random").mockReturnValue(0);
}

async function bodyOf(
  handler: PlayerDeathHandler,
  data: Record<string, unknown>,
  name = "Vancorbus",
): Promise<string> {
  const publisher = fakePublisher();
  const resolver = fakeResolverFromMap({ [VANCORBUS]: name });
  await handler.handle(fakeContext(publisher, resolver), playerDeathEvent({ data }));
  return (publisher.publish.mock.calls[0]![0]).body as string;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PlayerDeathHandler · shape del payload publicado", () => {
  it("supports('player.death') true; otros false", () => {
    const h = new PlayerDeathHandler();
    expect(h.supports("player.death")).toBe(true);
    expect(h.supports("player.kill")).toBe(false);
    expect(h.supports("mob.kill")).toBe(false);
    expect(h.supports("session.end")).toBe(false);
    expect(h.supports("")).toBe(false);
    expect(h.supports("PLAYER.DEATH")).toBe(false);
  });

  it("publica title='Crónica de muerte' + kind='player_death'", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "Vancorbus" });
    const h = new PlayerDeathHandler();

    await h.handle(fakeContext(publisher, resolver), playerDeathEvent());

    const call = publisher.publish.mock.calls[0]![0];
    expect(call.title).toBe("Crónica de muerte");
    expect(call.kind).toBe("player_death");
    expect(typeof call.body).toBe("string");
    expect(call.body.length).toBeGreaterThan(0);
  });
});

describe("PlayerDeathHandler · narración por categoría", () => {
  it("muerte por caída (cause=fall): body de la pool 'fall'", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(new PlayerDeathHandler(), { cause: "fall" });
    expect(body).toBe("💀 Vancorbus descubrió que la gravedad sigue funcionando.");
  });

  it("muerte por void: reusa la pool 'fall' (mismo tratamiento narrativo)", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(new PlayerDeathHandler(), { cause: "void" });
    expect(body).toBe("💀 Vancorbus descubrió que la gravedad sigue funcionando.");
  });

  it("muerte por creeper (entity_explosion + minecraft:creeper): pool 'creeper'", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(new PlayerDeathHandler(), {
      cause: "entity_explosion",
      killer_mob: "minecraft:creeper",
    });
    expect(body).toContain("Creeper");
    expect(body).toContain("Vancorbus");
  });

  it("muerte por lava (cause=lava): pool 'lava'", async () => {
    const body = await bodyOf(new PlayerDeathHandler(), { cause: "lava" });
    expect(body).toContain("Vancorbus");
    // La pool de lava menciona lava/nether/spa/líquido/temperatura/baño.
    expect(body).toMatch(/lava|spa|Nether|liquido|líquido|temperatura|baño/);
  });

  it("muerte por fuego (cause=fire | fire_tick): pool 'fire'", async () => {
    const bodyFire = await bodyOf(new PlayerDeathHandler(), { cause: "fire" });
    expect(bodyFire).toMatch(/fuego|llamas|quema|cocinado|temperatura/i);

    const bodyTick = await bodyOf(new PlayerDeathHandler(), { cause: "fire_tick" });
    expect(bodyTick).toMatch(/fuego|llamas|quema|cocinado|temperatura/i);
  });

  it("muerte por explosión NO-creeper (block_explosion / TNT): pool 'explosion'", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(new PlayerDeathHandler(), { cause: "block_explosion" });
    expect(body).toContain("Vancorbus");
    expect(body).toMatch(/polvora|pólvora|explosion|explosión|detonación|onda|TNT/);
    expect(body).not.toContain("Creeper");
  });

  it("muerte por proyectil de esqueleto (killer_mob=minecraft:skeleton): pool 'skeleton'", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(new PlayerDeathHandler(), {
      cause: "projectile",
      killer_mob: "minecraft:skeleton",
    });
    expect(body).toMatch(/esqueleto|flecha|arco|arquero|blanco/i);
  });

  it("muerte por ahogamiento (cause=drowning): pool 'drowning'", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(new PlayerDeathHandler(), { cause: "drowning" });
    expect(body).toMatch(/respirar|agua|pulmones|océano/);
  });

  it("muerte por zombie (entity_attack + minecraft:zombie): pool 'zombie'", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(new PlayerDeathHandler(), {
      cause: "entity_attack",
      killer_mob: "minecraft:zombie",
    });
    expect(body).toMatch(/zombie|cadáver/i);
  });

  it("muerte por hambre (cause=starvation): pool 'hunger'", async () => {
    stubRandomToFirstVariant();
    const body = await bodyOf(new PlayerDeathHandler(), { cause: "starvation" });
    expect(body).toMatch(/ayuno|refrigerador|hambre|comer|estómago/i);
  });

  it("prefiere killer_mob (más específico) sobre cause (más genérica)", async () => {
    // Un enderman ataca via entity_attack; el mob desambigua a "enderman".
    stubRandomToFirstVariant();
    const body = await bodyOf(new PlayerDeathHandler(), {
      cause: "entity_attack",
      killer_mob: "minecraft:enderman",
    });
    expect(body).toMatch(/Enderman|mir|teletransporte|contacto/i);
    expect(body).not.toMatch(/zombie|cadáver/i);
  });
});

describe("PlayerDeathHandler · selección aleatoria", () => {
  it("Math.random determina la variante seleccionada dentro de la pool", async () => {
    // 3 valores de random distintos → 3 bodies (posiblemente
    // repetidos si caen en el mismo bucket, pero cubrimos ≥ 2 distintos
    // porque la pool 'fall' tiene 8 variantes).
    const seen = new Set<string>();
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      seen.add(await bodyOf(new PlayerDeathHandler(), { cause: "fall" }));
      vi.restoreAllMocks();
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

describe("PlayerDeathHandler · fallback cuando no existe traducción", () => {
  it("cause y killer_mob desconocidos + vanillaMessage presente: usa el vanilla con prefijo", async () => {
    const body = await bodyOf(new PlayerDeathHandler(), {
      cause: "wither",
      killer_mob: "minecraft:wither",
      message: "Vancorbus withered away",
    });
    expect(body).toBe("💀 Vancorbus withered away");
  });

  it("cause desconocido + sin vanilla: fallback genérico con el nombre", async () => {
    const body = await bodyOf(new PlayerDeathHandler(), { cause: "cramming" });
    expect(body).toBe("💀 Vancorbus ha muerto.");
  });

  it("sin cause, sin killer_mob, sin vanilla: fallback genérico", async () => {
    const body = await bodyOf(new PlayerDeathHandler(), {});
    expect(body).toBe("💀 Vancorbus ha muerto.");
  });
});

describe("PlayerDeathHandler · integracion con resolver y publisher", () => {
  it("player_uuid null: MissingPlayerUuidError, resolver NO se llama, publisher NO se llama", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({});
    const h = new PlayerDeathHandler();
    const event = playerDeathEvent({
      playerUuid: null,
      eventUuid: "00000000-0000-4000-8000-cafecafecafe",
    });

    const err = await h
      .handle(fakeContext(publisher, resolver), event)
      .catch((e) => e);

    expect(err).toBeInstanceOf(MissingPlayerUuidError);
    expect((err as MissingPlayerUuidError).eventUuid).toBe(event.event_uuid);
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("resolver lanza PlayerNotFoundError: se propaga, publisher NO se llama", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({});
    const h = new PlayerDeathHandler();

    await expect(
      h.handle(fakeContext(publisher, resolver), playerDeathEvent()),
    ).rejects.toBeInstanceOf(PlayerNotFoundError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("resolver lanza HttpError: se propaga tal cual", async () => {
    const publisher = fakePublisher();
    const httpError = new PlayerLookupHttpError(VANCORBUS, 500, "boom");
    const resolver = {
      resolve: vi.fn(async () => {
        throw httpError;
      }),
    } as unknown as PlayerNameResolver;
    const h = new PlayerDeathHandler();

    const err = await h
      .handle(fakeContext(publisher, resolver), playerDeathEvent())
      .catch((e) => e);
    expect(err).toBe(httpError);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("publisher llamado exactamente una vez en caso feliz", async () => {
    const publisher = fakePublisher();
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "X" });
    const h = new PlayerDeathHandler();
    await h.handle(fakeContext(publisher, resolver), playerDeathEvent());
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it("error del publisher se propaga tal cual", async () => {
    const boom = new Error("publish boom");
    const publisher: Publisher = {
      publish: vi.fn(async () => {
        throw boom;
      }),
    };
    const resolver = fakeResolverFromMap({ [VANCORBUS]: "X" });
    const h = new PlayerDeathHandler();
    await expect(
      h.handle(fakeContext(publisher, resolver), playerDeathEvent()),
    ).rejects.toBe(boom);
  });
});
