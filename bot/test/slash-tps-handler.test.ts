import { describe, it, expect, vi } from "vitest";
import {
  computeTpsView,
  handleTps,
  renderTpsLine,
  TPS_FRESHNESS_THRESHOLD_MS,
} from "../src/slash/tps-handler";
import type { LatestByTypeEvent } from "../src/slash/api-client";
import { SlashApiError } from "../src/slash/api-client";

function makeEvent(overrides: Partial<LatestByTypeEvent> = {}): LatestByTypeEvent {
  return {
    id: "42",
    event_uuid: "00000000-0000-4000-8000-000000000042",
    type: "server.tps_sample",
    v: 1,
    ts: "2026-08-11T14:22:15.000Z",
    received_at: "2026-08-11T14:22:15.010Z",
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data: { tps_1m: 19.84 },
    ...overrides,
  };
}

const NOW = new Date("2026-08-11T14:22:30.000Z"); // 15s después del sample

describe("computeTpsView", () => {
  it("fresh: sample de hace <90s → { fresh: true, tps, ageMs }", async () => {
    const view = await computeTpsView({
      apiClient: { getLatestByType: vi.fn().mockResolvedValue([makeEvent()]) },
      now: () => NOW,
    });
    expect(view).toEqual({
      fresh: true,
      tps: 19.84,
      ageMs: 15_000,
      reason: "fresh",
    });
  });

  it("stale: sample de hace ≥90s → { fresh: false, reason: 'stale' }", async () => {
    const oldSample = makeEvent({ ts: "2026-08-11T14:20:00.000Z" }); // 150s ago
    const view = await computeTpsView({
      apiClient: { getLatestByType: vi.fn().mockResolvedValue([oldSample]) },
      now: () => NOW,
    });
    expect(view.fresh).toBe(false);
    expect(view.reason).toBe("stale");
    expect(view.tps).toBe(19.84);
    expect(view.ageMs).toBe(150_000);
  });

  it("no_samples: array vacío → reason 'no_samples'", async () => {
    const view = await computeTpsView({
      apiClient: { getLatestByType: vi.fn().mockResolvedValue([]) },
      now: () => NOW,
    });
    expect(view).toEqual({
      fresh: false,
      tps: null,
      ageMs: null,
      reason: "no_samples",
    });
  });

  it("invalid_shape: sample sin data.tps_1m numérico → reason 'invalid_shape'", async () => {
    const bad = makeEvent({ data: { tps_1m: "no numérico" } });
    const view = await computeTpsView({
      apiClient: { getLatestByType: vi.fn().mockResolvedValue([bad]) },
      now: () => NOW,
    });
    expect(view.reason).toBe("invalid_shape");
  });

  it("threshold custom se respeta", async () => {
    // Sample de hace 50s con threshold 30s → stale.
    const view = await computeTpsView({
      apiClient: { getLatestByType: vi.fn().mockResolvedValue([makeEvent({ ts: "2026-08-11T14:21:40.000Z" })]) },
      now: () => NOW,
      freshnessThresholdMs: 30_000,
    });
    expect(view.reason).toBe("stale");
  });

  it("default threshold es el exportado TPS_FRESHNESS_THRESHOLD_MS", () => {
    expect(TPS_FRESHNESS_THRESHOLD_MS).toBe(90_000);
  });
});

describe("renderTpsLine", () => {
  it("fresh → 'TPS 1m: 19.84 (hace 15s)'", () => {
    expect(
      renderTpsLine({ fresh: true, tps: 19.84, ageMs: 15_000, reason: "fresh" }),
    ).toBe("⚡ TPS 1m: 19.84 (hace 15s)");
  });
  it("stale → 'TPS no disponible (último sample de hace 2m 30s)' formato", () => {
    const s = renderTpsLine({ fresh: false, tps: 19.84, ageMs: 150_000, reason: "stale" });
    expect(s).toContain("TPS no disponible");
    expect(s).toContain("2m");
  });
  it("no_samples → mensaje explícito 'sin samples aún'", () => {
    expect(
      renderTpsLine({ fresh: false, tps: null, ageMs: null, reason: "no_samples" }),
    ).toContain("sin samples aún");
  });
  it("invalid_shape → mensaje explícito de shape inválido", () => {
    expect(
      renderTpsLine({ fresh: false, tps: null, ageMs: null, reason: "invalid_shape" }),
    ).toContain("shape inválido");
  });
});

describe("handleTps", () => {
  it("happy path → reply ephemeral con la línea de tps", async () => {
    const interaction = { reply: vi.fn().mockResolvedValue(undefined) };
    await handleTps(interaction, {
      apiClient: { getLatestByType: vi.fn().mockResolvedValue([makeEvent()]) },
      now: () => NOW,
    });
    const arg = interaction.reply.mock.calls[0]![0] as { content: string; ephemeral: boolean };
    expect(arg.ephemeral).toBe(true);
    expect(arg.content).toContain("TPS 1m: 19.84");
  });

  it("api error → reply de fallback ephemeral, sin throw", async () => {
    const interaction = { reply: vi.fn().mockResolvedValue(undefined) };
    await handleTps(interaction, {
      apiClient: {
        getLatestByType: vi.fn().mockRejectedValue(new SlashApiError("timeout")),
      },
      now: () => NOW,
    });
    const arg = interaction.reply.mock.calls[0]![0] as { content: string; ephemeral: boolean };
    expect(arg.content).toContain("No puedo consultar");
    expect(arg.content).toContain("timeout");
    expect(arg.ephemeral).toBe(true);
  });
});
