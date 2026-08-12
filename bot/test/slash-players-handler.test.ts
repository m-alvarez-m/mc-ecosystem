import { describe, it, expect, vi } from "vitest";
import { handlePlayers } from "../src/slash/players-handler";
import { TtlCache } from "../src/slash/cache";
import type { OnlinePlayer } from "../src/slash/api-client";
import { SlashApiError } from "../src/slash/api-client";

// ADR-016 D6: mock manual de la interacción con vi.fn(); now inyectada;
// api client como Pick<> vía vi.fn(). Cero red, cero Date.now real.

function makeInteraction() {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

function makeCache(): TtlCache<OnlinePlayer[]> {
  return new TtlCache<OnlinePlayer[]>(10_000, () => new Date(0));
}

describe("handlePlayers", () => {
  const NOW = new Date("2026-08-11T15:00:00.000Z");

  it("happy path: 2 online, ambos <24h → embed ephemeral con líneas relativas", async () => {
    const players: OnlinePlayer[] = [
      {
        uuid: "71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
        name: "Vancorbus",
        session_start_ts: "2026-08-11T14:00:00.000Z", // hace 1h
      },
      {
        uuid: "aaaa",
        name: "Pacman26",
        session_start_ts: "2026-08-11T14:45:00.000Z", // hace 15m
      },
    ];
    const interaction = makeInteraction();
    await handlePlayers(interaction, {
      apiClient: { getPlayersOnline: vi.fn().mockResolvedValue(players) },
      now: () => NOW,
      cache: makeCache(),
    });

    expect(interaction.reply).toHaveBeenCalledOnce();
    const arg = interaction.reply.mock.calls[0]![0] as {
      embeds: unknown[];
      ephemeral: boolean;
    };
    expect(arg.ephemeral).toBe(true);
    expect(arg.embeds).toHaveLength(1);
    const embed = (arg.embeds[0] as { data: { title: string; description: string } }).data;
    expect(embed.title).toContain("Jugadores online (2)");
    expect(embed.description).toContain("Vancorbus");
    expect(embed.description).toContain("Pacman26");
    expect(embed.description).toContain("hace 1h");
    expect(embed.description).toContain("hace 15m");
  });

  it("sin jugadores → mensaje 'Sin jugadores online' ephemeral", async () => {
    const interaction = makeInteraction();
    await handlePlayers(interaction, {
      apiClient: { getPlayersOnline: vi.fn().mockResolvedValue([]) },
      now: () => NOW,
      cache: makeCache(),
    });
    const arg = interaction.reply.mock.calls[0]![0] as {
      content: string;
      ephemeral: boolean;
    };
    expect(arg.ephemeral).toBe(true);
    expect(arg.content).toContain("Sin jugadores online");
  });

  it("api falla → mensaje de fallback ephemeral, sin throw", async () => {
    const interaction = makeInteraction();
    const apiClient = {
      getPlayersOnline: vi.fn().mockRejectedValue(new SlashApiError("api down")),
    };
    await expect(
      handlePlayers(interaction, {
        apiClient,
        now: () => NOW,
        cache: makeCache(),
      }),
    ).resolves.toBeUndefined();
    const arg = interaction.reply.mock.calls[0]![0] as {
      content: string;
      ephemeral: boolean;
    };
    expect(arg.content).toContain("No puedo consultar");
    expect(arg.content).toContain("api down");
    expect(arg.ephemeral).toBe(true);
  });

  it("cache dedup: 2 ejecuciones consecutivas → 1 sola llamada al api", async () => {
    const cache = new TtlCache<OnlinePlayer[]>(10_000, () => new Date(0));
    const apiClient = { getPlayersOnline: vi.fn().mockResolvedValue([]) };
    const i1 = makeInteraction();
    const i2 = makeInteraction();
    await handlePlayers(i1, { apiClient, now: () => NOW, cache });
    await handlePlayers(i2, { apiClient, now: () => NOW, cache });
    expect(apiClient.getPlayersOnline).toHaveBeenCalledTimes(1);
  });
});
