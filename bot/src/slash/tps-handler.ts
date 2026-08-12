import type { ChatInputCommandInteraction } from "discord.js";
import { SlashApiClient, SlashApiError, LatestByTypeEvent } from "./api-client";
import { formatRelative } from "./format-time";

// Handler de /tps (ADR-016 D3).
//
// Fuente: GET /events/latest_by_type?type=server.tps_sample&limit=1.
// Guardia de freshness: 90 s (heredado del criterio de TpsHandler,
// BUG-02A §3 — "publicar TPS antiguo es mentir").
//
// - Sample fresh   → "TPS 1m: X.XX (hace Ys)"
// - Sample stale   → "TPS no disponible (último sample de hace X)"
// - Sin samples    → "TPS no disponible (sin samples aún)"

export const TPS_FRESHNESS_THRESHOLD_MS = 90 * 1000;

export interface TpsHandlerDeps {
  apiClient: Pick<SlashApiClient, "getLatestByType">;
  now: () => Date;
  freshnessThresholdMs?: number;
}

export interface TpsView {
  fresh: boolean;
  tps: number | null;
  ageMs: number | null;
  reason: "fresh" | "stale" | "no_samples" | "invalid_shape";
}

export async function computeTpsView(
  deps: TpsHandlerDeps,
): Promise<TpsView> {
  const threshold = deps.freshnessThresholdMs ?? TPS_FRESHNESS_THRESHOLD_MS;
  const events = await deps.apiClient.getLatestByType("server.tps_sample", 1);
  if (events.length === 0) {
    return { fresh: false, tps: null, ageMs: null, reason: "no_samples" };
  }
  const ev = events[0]!;
  const tps = extractTps(ev);
  if (tps === null) {
    return { fresh: false, tps: null, ageMs: null, reason: "invalid_shape" };
  }
  const ageMs = deps.now().getTime() - new Date(ev.ts).getTime();
  if (ageMs >= threshold) {
    return { fresh: false, tps, ageMs, reason: "stale" };
  }
  return { fresh: true, tps, ageMs, reason: "fresh" };
}

export function renderTpsLine(view: TpsView): string {
  if (view.reason === "no_samples") return "⚡ TPS no disponible (sin samples aún)";
  if (view.reason === "invalid_shape")
    return "⚡ TPS no disponible (sample con shape inválido)";
  if (view.reason === "stale")
    return `⚡ TPS no disponible (último sample de ${formatRelative(view.ageMs!)})`;
  return `⚡ TPS 1m: ${view.tps!.toFixed(2)} (${formatRelative(view.ageMs!)})`;
}

export async function handleTps(
  interaction: Pick<ChatInputCommandInteraction, "reply">,
  deps: TpsHandlerDeps,
): Promise<void> {
  let view: TpsView;
  try {
    view = await computeTpsView(deps);
  } catch (err) {
    const detail = err instanceof SlashApiError ? err.message : String(err);
    await interaction.reply({
      content: `⚠️ No puedo consultar el servidor ahora, reintentá en un momento. (${detail})`,
      ephemeral: true,
    });
    return;
  }
  await interaction.reply({ content: renderTpsLine(view), ephemeral: true });
}

function extractTps(ev: LatestByTypeEvent): number | null {
  const raw = ev.data?.["tps_1m"];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw;
}
