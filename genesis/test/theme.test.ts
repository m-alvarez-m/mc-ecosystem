import { describe, it, expect } from "vitest";
import {
  colors,
  spacing,
  radius,
  typography,
  zIndex,
  transitions,
  breakpoints,
  media,
  tokens,
} from "../src/theme";

// Tests del contrato de tokens (D2). No probamos APARIENCIA visual —
// solo forma y valores estables. Cambiar aqui obliga a revisar
// theme.css y todos los componentes que dependen del token.

describe("theme · tokens", () => {
  it("colors: expone rol semantico y escala neutral completa", () => {
    expect(colors.background).toBeDefined();
    expect(colors.surface).toBeDefined();
    expect(colors.border).toBeDefined();
    expect(colors.text).toBeDefined();
    expect(colors.textMuted).toBeDefined();
    expect(colors.textInverse).toBeDefined();
    expect(colors.focusRing).toBeDefined();
    for (const key of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const) {
      expect(colors.neutral[key]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    for (const key of ["primary", "success", "warning", "danger", "info"] as const) {
      expect(colors.semantic[key]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("spacing: escala 0-16 completa y estable en px", () => {
    expect(spacing[0]).toBe("0");
    expect(spacing[1]).toBe("4px");
    expect(spacing[4]).toBe("16px");
    expect(spacing[16]).toBe("64px");
    for (const key of [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16] as const) {
      expect(spacing[key]).toBeDefined();
    }
  });

  it("radius: valores esperados", () => {
    expect(radius.none).toBe("0");
    expect(radius.sm).toBe("4px");
    expect(radius.md).toBe("8px");
    expect(radius.lg).toBe("12px");
    expect(radius.full).toBe("9999px");
  });

  it("typography: familias, tamaños, pesos y line-heights", () => {
    expect(typography.fontFamily.sans).toContain("system");
    expect(typography.fontFamily.mono).toBeDefined();
    for (const size of ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const) {
      expect(typography.fontSize[size]).toMatch(/^\d+px$/);
    }
    for (const w of ["regular", "medium", "semibold", "bold"] as const) {
      expect(typeof typography.fontWeight[w]).toBe("number");
    }
    expect(typography.lineHeight.tight).toBeLessThan(typography.lineHeight.normal);
    expect(typography.lineHeight.normal).toBeLessThan(typography.lineHeight.relaxed);
  });

  it("zIndex: escala monotonica base < content < header < overlay < modal < toast", () => {
    expect(zIndex.base).toBeLessThan(zIndex.content);
    expect(zIndex.content).toBeLessThan(zIndex.header);
    expect(zIndex.header).toBeLessThan(zIndex.overlay);
    expect(zIndex.overlay).toBeLessThan(zIndex.modal);
    expect(zIndex.modal).toBeLessThan(zIndex.toast);
  });

  it("transitions: duraciones en ms crecientes fast < normal < slow", () => {
    const parseMs = (v: string) => Number(v.replace("ms", ""));
    expect(parseMs(transitions.duration.fast)).toBeLessThan(
      parseMs(transitions.duration.normal),
    );
    expect(parseMs(transitions.duration.normal)).toBeLessThan(
      parseMs(transitions.duration.slow),
    );
    expect(transitions.easing.standard).toContain("cubic-bezier");
  });

  it("breakpoints: crecientes xs < sm < md < lg y media queries generadas", () => {
    const parsePx = (v: string) => Number(v.replace("px", ""));
    expect(parsePx(breakpoints.xs)).toBeLessThan(parsePx(breakpoints.sm));
    expect(parsePx(breakpoints.sm)).toBeLessThan(parsePx(breakpoints.md));
    expect(parsePx(breakpoints.md)).toBeLessThan(parsePx(breakpoints.lg));
    expect(media.md).toContain(breakpoints.md);
  });

  it("bundle `tokens` expone todas las categorias sin campos extra", () => {
    expect(Object.keys(tokens).sort()).toEqual(
      [
        "breakpoints",
        "colors",
        "media",
        "radius",
        "spacing",
        "transitions",
        "typography",
        "zIndex",
      ].sort(),
    );
  });
});
