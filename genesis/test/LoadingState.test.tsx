import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingState } from "../src/components";

// Contrato de LoadingState (D3): role=status + aria-live, sin
// spinners gigantes (verificamos por texto y forma minima).

describe("LoadingState", () => {
  it("renderiza role=status con aria-live=polite", () => {
    const { container } = render(<LoadingState />);
    const el = container.querySelector('[role="status"]')!;
    expect(el).toBeInTheDocument();
    expect(el.getAttribute("aria-live")).toBe("polite");
  });

  it("label por defecto es 'Cargando…'", () => {
    render(<LoadingState />);
    expect(screen.getByText("Cargando…")).toBeInTheDocument();
  });

  it("acepta label custom", () => {
    render(<LoadingState label="Cargando insights…" />);
    expect(screen.getByText("Cargando insights…")).toBeInTheDocument();
  });

  it("propaga className adicional sin borrar los internos", () => {
    const { container } = render(<LoadingState className="mio" />);
    const el = container.querySelector('[role="status"]') as HTMLElement;
    expect(el.className).toContain("mio");
    expect(el.className.split(" ").length).toBeGreaterThan(1);
  });
});
