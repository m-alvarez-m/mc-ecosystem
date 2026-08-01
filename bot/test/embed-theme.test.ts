import { describe, it, expect } from "vitest";
import {
  FOOTER_TEXT,
  KIND_COLORS,
  NEUTRAL_COLOR,
  colorForKind,
} from "../src/discord/embed-theme";
import type { MessageKind } from "../src/publisher";

// Tests estructurales del tema visual de Pulso.
// Verifican invariantes que romperlas causaría bugs sistemáticos
// (kind sin color, colores duplicados, footer vacío).

const EXPECTED_KINDS: readonly MessageKind[] = [
  "server_started",
  "server_stopped",
  "player_joined",
  "player_left",
  "player_death",
  "advancement",
  "chat",
  "tps_degraded",
  "backup",
  "dimension_first_enter",
  "server_milestone",
  "boss_kill",
  "player_kill",
  "craft_milestone",
];

describe("embed-theme", () => {
  it("FOOTER_TEXT no vacío", () => {
    expect(FOOTER_TEXT.trim().length).toBeGreaterThan(0);
  });

  it("KIND_COLORS cubre exactamente los 14 kinds de MessageKind", () => {
    const catalogKinds = Object.keys(KIND_COLORS).sort();
    const expected = [...EXPECTED_KINDS].sort();
    expect(catalogKinds).toEqual(expected);
  });

  it("todos los colores son enteros en el rango de 24-bit hex (0..0xFFFFFF)", () => {
    for (const [kind, color] of Object.entries(KIND_COLORS)) {
      expect(Number.isInteger(color), `color de ${kind}`).toBe(true);
      expect(color, `color de ${kind}`).toBeGreaterThanOrEqual(0);
      expect(color, `color de ${kind}`).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("NEUTRAL_COLOR es un hex válido (24-bit)", () => {
    expect(Number.isInteger(NEUTRAL_COLOR)).toBe(true);
    expect(NEUTRAL_COLOR).toBeGreaterThanOrEqual(0);
    expect(NEUTRAL_COLOR).toBeLessThanOrEqual(0xffffff);
  });

  it("colorForKind resuelve cada kind al mismo valor del catálogo", () => {
    for (const kind of EXPECTED_KINDS) {
      expect(colorForKind(kind)).toBe(KIND_COLORS[kind]);
    }
  });

  it("colorForKind(undefined): devuelve NEUTRAL_COLOR (retrocompatibilidad)", () => {
    expect(colorForKind(undefined)).toBe(NEUTRAL_COLOR);
  });

  it("paleta acordada (spot-check de identidad visual v1.1)", () => {
    // Colores canónicos según la paleta acordada en T6.
    expect(KIND_COLORS.server_started).toBe(0x2ecc71); // verde
    expect(KIND_COLORS.server_stopped).toBe(0xe74c3c); // rojo
    expect(KIND_COLORS.chat).toBe(0x3498db); // azul
    expect(KIND_COLORS.player_death).toBe(0x8b0000); // rojo oscuro
    expect(KIND_COLORS.advancement).toBe(0x9b59b6); // morado
    expect(KIND_COLORS.tps_degraded).toBe(0xf1c40f); // amarillo
    expect(KIND_COLORS.server_milestone).toBe(0xf39c12); // dorado
    expect(KIND_COLORS.boss_kill).toBe(0xc0392b); // rojo profundo
    expect(KIND_COLORS.player_kill).toBe(0xe74c3c); // rojo (duelo PvP)
    expect(KIND_COLORS.craft_milestone).toBe(0xf1c40f); // oro brillante
  });
});
