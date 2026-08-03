import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState, Button } from "../src/components";

// Contrato de EmptyState (D3): title obligatorio, body opcional,
// actions opcional, role=status + aria-live=polite.

describe("EmptyState", () => {
  it("renderiza title dentro de un heading", () => {
    render(<EmptyState title="Aún no hay insights" />);
    // El componente usa <h2>: buscamos por rol heading.
    expect(
      screen.getByRole("heading", { name: /aún no hay insights/i }),
    ).toBeInTheDocument();
  });

  it("pinta body cuando se provee y no lo pinta cuando no", () => {
    const { rerender } = render(
      <EmptyState title="Sin datos" body="Vuelve más tarde." />,
    );
    expect(screen.getByText("Vuelve más tarde.")).toBeInTheDocument();
    rerender(<EmptyState title="Sin datos" />);
    expect(screen.queryByText("Vuelve más tarde.")).toBeNull();
  });

  it("pinta el slot de actions cuando se provee", () => {
    render(
      <EmptyState
        title="Sin datos"
        actions={<Button size="sm">Recargar</Button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: /recargar/i }),
    ).toBeInTheDocument();
  });

  it("expone role=status + aria-live=polite", () => {
    const { container } = render(<EmptyState title="x" />);
    const el = container.querySelector('[role="status"]')!;
    expect(el).toBeInTheDocument();
    expect(el.getAttribute("aria-live")).toBe("polite");
  });
});
