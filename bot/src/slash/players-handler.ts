import type {
  ChatInputCommandInteraction,
  EmbedBuilder as EmbedBuilderType,
} from "discord.js";
import { EmbedBuilder } from "discord.js";
import { SlashApiClient, SlashApiError } from "./api-client";
import { TtlCache } from "./cache";
import { formatRelativeOrAbsolute } from "./format-time";

// Handler de /players (ADR-016 D3).
//
// Fuente: GET /players/online del api (endpoint nuevo B.1).
// TTL cache: 10 s (POLL_INTERVAL_MS=5000 × 2).
// Formato temporal: <24h relativo / ≥24h absoluto en America/Monterrey.
// Ephemeral: true (ADR-016 D5).

export interface PlayersHandlerDeps {
  apiClient: Pick<SlashApiClient, "getPlayersOnline">;
  now: () => Date;
  cache: TtlCache<import("./api-client").OnlinePlayer[]>;
}

export async function handlePlayers(
  interaction: Pick<ChatInputCommandInteraction, "reply">,
  deps: PlayersHandlerDeps,
): Promise<void> {
  let players: import("./api-client").OnlinePlayer[];
  try {
    players = await deps.cache.getOrCompute(() =>
      deps.apiClient.getPlayersOnline(),
    );
  } catch (err) {
    const detail = err instanceof SlashApiError ? err.message : String(err);
    await interaction.reply({
      content: `⚠️ No puedo consultar el servidor ahora, reintentá en un momento. (${detail})`,
      ephemeral: true,
    });
    return;
  }

  if (players.length === 0) {
    await interaction.reply({
      content: "🌙 Sin jugadores online.",
      ephemeral: true,
    });
    return;
  }

  const now = deps.now();
  const lines = players.map((p) => {
    const start = new Date(p.session_start_ts);
    return `• **${p.name}** — conectado ${formatRelativeOrAbsolute(start, now)}`;
  });

  const embed: EmbedBuilderType = new EmbedBuilder()
    .setTitle(`🎮 Jugadores online (${players.length})`)
    .setDescription(lines.join("\n"))
    .setTimestamp(now);

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
