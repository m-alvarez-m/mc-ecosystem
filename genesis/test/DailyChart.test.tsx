import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DailyChart } from "../src/features/activity";

describe("DailyChart", () => {
  it("rellena huecos entre from y to con count=0", () => {
    render(
      <DailyChart
        buckets={[{ date: "2026-07-27", count: "50" }]}
        from="2026-07-26T00:00:00Z"
        to="2026-07-28T00:00:00Z"
      />,
    );
    const grid = screen.getByRole("list", {
      name: /actividad diaria en la ventana temporal/i,
    });
    const items = within(grid).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    const dataCounts = within(grid)
      .getAllByRole("img")
      .map((el) => `${el.closest<HTMLElement>('[data-date]')?.getAttribute("data-date")}=${el.closest<HTMLElement>('[data-date]')?.getAttribute("data-count")}`);
    expect(dataCounts).toEqual([
      "2026-07-26=0",
      "2026-07-27=50",
      "2026-07-28=0",
    ]);
  });

  it("intensity: dia con max → 1, otros proporcional", () => {
    render(
      <DailyChart
        buckets={[
          { date: "2026-07-26", count: "10" },
          { date: "2026-07-27", count: "100" },
        ]}
        from="2026-07-26T00:00:00Z"
        to="2026-07-27T00:00:00Z"
      />,
    );
    const bars = screen.getAllByRole("img") as HTMLElement[];
    const b26 = bars.find(
      (b) => b.closest<HTMLElement>('[data-date]')?.getAttribute("data-date") === "2026-07-26",
    )!;
    const b27 = bars.find(
      (b) => b.closest<HTMLElement>('[data-date]')?.getAttribute("data-date") === "2026-07-27",
    )!;
    expect(Number(b27.style.getPropertyValue("--pct"))).toBeCloseTo(1, 5);
    expect(Number(b26.style.getPropertyValue("--pct"))).toBeCloseTo(0.1, 5);
  });

  it("aria-label del bar incluye fecha ISO + cuenta", () => {
    render(
      <DailyChart
        buckets={[{ date: "2026-07-27", count: "50" }]}
        from="2026-07-27T00:00:00Z"
        to="2026-07-27T00:00:00Z"
      />,
    );
    expect(
      screen.getByRole("img", { name: /2026-07-27 · 50 eventos/i }),
    ).toBeInTheDocument();
  });

  it("label corto en es-ES ('27 jul')", () => {
    render(
      <DailyChart
        buckets={[{ date: "2026-07-27", count: "50" }]}
        from="2026-07-27T00:00:00Z"
        to="2026-07-27T00:00:00Z"
      />,
    );
    expect(screen.getByText(/27 jul/)).toBeInTheDocument();
  });

  it("from inválido: no rellena, pinta sólo los buckets recibidos", () => {
    render(
      <DailyChart
        buckets={[{ date: "2026-07-27", count: "50" }]}
        from="basura"
        to="basura"
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
  });

  it("data-testid daily-chart aislable desde tests padres", () => {
    const { container } = render(
      <DailyChart
        buckets={[]}
        from="2026-07-27T00:00:00Z"
        to="2026-07-27T00:00:00Z"
      />,
    );
    expect(container.querySelector('[data-testid="daily-chart"]'))
      .not.toBeNull();
  });
});
