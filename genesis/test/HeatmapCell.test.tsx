import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeatmapCell } from "../src/features/activity";

describe("HeatmapCell", () => {
  it("role=img + aria-label con hora + eventos (accesible sin hover)", () => {
    render(<HeatmapCell hour={3} count="128" intensity={0.5} />);
    const el = screen.getByRole("img", {
      name: /hora 03:00 utc · 128 eventos/i,
    });
    expect(el).toBeInTheDocument();
  });

  it("title (tooltip nativo) duplica el aria-label como refuerzo", () => {
    render(<HeatmapCell hour={12} count="42" intensity={0.2} />);
    const el = screen.getByRole("img");
    expect(el.getAttribute("title")).toBe(el.getAttribute("aria-label"));
  });

  it("data-hour y data-count viajan como atributos aislables", () => {
    render(<HeatmapCell hour={23} count="9" intensity={0.1} />);
    const el = screen.getByRole("img");
    expect(el.getAttribute("data-hour")).toBe("23");
    expect(el.getAttribute("data-count")).toBe("9");
  });

  it("opacity se calcula en escala 0.08..1", () => {
    const { rerender } = render(
      <HeatmapCell hour={0} count="0" intensity={0} />,
    );
    let el = screen.getByRole("img") as HTMLElement;
    expect(el.style.opacity).toBe("0.08");
    rerender(<HeatmapCell hour={0} count="99" intensity={1} />);
    el = screen.getByRole("img") as HTMLElement;
    expect(el.style.opacity).toBe("1");
  });

  it("intensity fuera de rango se recorta al intervalo [0,1]", () => {
    const { rerender } = render(
      <HeatmapCell hour={0} count="0" intensity={-1} />,
    );
    let el = screen.getByRole("img") as HTMLElement;
    expect(el.style.opacity).toBe("0.08");
    rerender(<HeatmapCell hour={0} count="0" intensity={5} />);
    el = screen.getByRole("img") as HTMLElement;
    expect(el.style.opacity).toBe("1");
  });

  it("hour 0..9 se formatea con cero a la izquierda (00:00, 03:00)", () => {
    render(<HeatmapCell hour={0} count="1" intensity={0.1} />);
    expect(
      screen.getByRole("img", { name: /hora 00:00 utc/i }),
    ).toBeInTheDocument();
  });
});
