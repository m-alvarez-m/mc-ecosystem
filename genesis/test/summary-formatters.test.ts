import { describe, it, expect } from "vitest";
import { formatCount } from "../src/features/summary";

// Contrato del formatter `formatCount` (D4). BIGINT-safe + grouping
// es-ES (separador de miles = punto).

describe("formatCount", () => {
  it("aplica grouping es-ES a numeros pequenos", () => {
    expect(formatCount(1234)).toBe("1.234");
    expect(formatCount("1234")).toBe("1.234");
  });

  it("acepta cero y devuelve '0' sin puntos", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount("0")).toBe("0");
  });

  it("preserva precision con BigInt (mas alla de 2^53)", () => {
    const beyondSafe = "9007199254740993"; // 2^53 + 1
    expect(formatCount(beyondSafe)).toBe("9.007.199.254.740.993");
  });

  it("null / undefined → em-dash", () => {
    expect(formatCount(null)).toBe("—");
    expect(formatCount(undefined)).toBe("—");
  });

  it("string vacia → em-dash", () => {
    expect(formatCount("")).toBe("—");
    expect(formatCount("   ")).toBe("—");
  });

  it("string no numerica se devuelve tal cual (defensivo)", () => {
    expect(formatCount("N/A")).toBe("N/A");
    expect(formatCount("foo123")).toBe("foo123");
  });

  it("numeros negativos se formatean con signo", () => {
    expect(formatCount(-1000)).toBe("-1.000");
    expect(formatCount("-1000")).toBe("-1.000");
  });

  it("Number no finito (NaN, Infinity) se devuelve como String() (defensivo)", () => {
    expect(formatCount(Number.NaN)).toBe("NaN");
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});
