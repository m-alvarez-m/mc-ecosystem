import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { HourlyHeatmap } from "../src/features/activity";

describe("HourlyHeatmap", () => {
  it("renderiza SIEMPRE 24 celdas fijas aunque la API devuelva pocas", () => {
    render(<HourlyHeatmap buckets={[{ hour: 12, count: "42" }]} />);
    const grid = screen.getByRole("list", {
      name: /actividad por hora del día \(utc\)/i,
    });
    expect(within(grid).getAllByRole("listitem")).toHaveLength(24);
    expect(within(grid).getAllByRole("img")).toHaveLength(24);
  });

  it("horas ausentes se rellenan con count=0", () => {
    render(<HourlyHeatmap buckets={[{ hour: 12, count: "42" }]} />);
    const cells = screen.getAllByRole("img");
    // hour 5 no viene en el input -> debe tener count 0.
    const h5 = cells.find((c) => c.getAttribute("data-hour") === "5");
    expect(h5?.getAttribute("data-count")).toBe("0");
    const h12 = cells.find((c) => c.getAttribute("data-hour") === "12");
    expect(h12?.getAttribute("data-count")).toBe("42");
  });

  it("intensity: el max normaliza a 1; el resto proporcional", () => {
    render(
      <HourlyHeatmap
        buckets={[
          { hour: 0, count: "10" },
          { hour: 12, count: "100" },
        ]}
      />,
    );
    const cells = screen.getAllByRole("img") as HTMLElement[];
    const h0 = cells.find((c) => c.getAttribute("data-hour") === "0")!;
    const h12 = cells.find((c) => c.getAttribute("data-hour") === "12")!;
    // Max=100. h12 → opacity 1; h0 (10/100=0.1) → 0.08 + 0.1*0.92 = 0.172.
    expect(Number(h12.style.opacity)).toBeCloseTo(1, 5);
    expect(Number(h0.style.opacity)).toBeCloseTo(0.172, 3);
  });

  it("buckets vacíos: todas las celdas al mínimo (opacity 0.08)", () => {
    render(<HourlyHeatmap buckets={[]} />);
    const cells = screen.getAllByRole("img") as HTMLElement[];
    for (const c of cells) {
      expect(Number(c.style.opacity)).toBeCloseTo(0.08, 5);
    }
  });

  it("expone data-testid para localizar el heatmap desde tests padres", () => {
    const { container } = render(
      <HourlyHeatmap buckets={[{ hour: 12, count: "42" }]} />,
    );
    expect(container.querySelector('[data-testid="hourly-heatmap"]'))
      .not.toBeNull();
  });
});
