import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChartBar } from "../src/features/activity";

describe("ChartBar", () => {
  it("role=img + aria-label completo (info accesible sin hover)", () => {
    render(
      <ChartBar
        date="2026-07-26"
        count="128"
        label="26 jul"
        ariaLabel="2026-07-26 · 128 eventos"
        intensity={0.5}
      />,
    );
    expect(
      screen.getByRole("img", { name: /2026-07-26 · 128 eventos/i }),
    ).toBeInTheDocument();
  });

  it("title coincide con aria-label", () => {
    render(
      <ChartBar
        date="2026-07-26"
        count="128"
        label="26 jul"
        ariaLabel="2026-07-26 · 128 eventos"
        intensity={0.5}
      />,
    );
    const bar = screen.getByRole("img");
    expect(bar.getAttribute("title")).toBe(bar.getAttribute("aria-label"));
  });

  it("label visible bajo la barra", () => {
    render(
      <ChartBar
        date="2026-07-26"
        count="128"
        label="26 jul"
        ariaLabel="x"
        intensity={0.5}
      />,
    );
    expect(screen.getByText("26 jul")).toBeInTheDocument();
  });

  it("intensity → CSS var --pct como decimal recortado", () => {
    render(
      <ChartBar
        date="2026-07-26"
        count="128"
        label="26 jul"
        ariaLabel="x"
        intensity={0.75}
      />,
    );
    const bar = screen.getByRole("img") as HTMLElement;
    expect(bar.style.getPropertyValue("--pct")).toBe("0.7500");
  });

  it("count=0 → barra marcada como vacía (gris, aria-label mantiene 0)", () => {
    render(
      <ChartBar
        date="2026-07-27"
        count="0"
        label="27 jul"
        ariaLabel="2026-07-27 · 0 eventos"
        intensity={0}
      />,
    );
    const bar = screen.getByRole("img");
    // La clase interna se hashea; verificamos por atributo estable.
    expect(bar.className).toMatch(/barEmpty|_barEmpty/);
    expect(bar.getAttribute("aria-label")).toMatch(/0 eventos/);
  });

  it("date + count viajan como data-attrs en el contenedor", () => {
    const { container } = render(
      <ChartBar
        date="2026-07-27"
        count="99"
        label="27 jul"
        ariaLabel="x"
        intensity={0.1}
      />,
    );
    const wrap = container.querySelector<HTMLElement>("[data-date]");
    expect(wrap?.getAttribute("data-date")).toBe("2026-07-27");
    expect(wrap?.getAttribute("data-count")).toBe("99");
  });
});
