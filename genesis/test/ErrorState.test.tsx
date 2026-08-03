import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorState } from "../src/components";

// Contrato de ErrorState (D3): role=alert, title default "Error al
// cargar", message opcional, boton Reintentar solo si hay onRetry.

describe("ErrorState", () => {
  it("renderiza role=alert", () => {
    const { container } = render(<ErrorState />);
    expect(container.querySelector('[role="alert"]')).toBeInTheDocument();
  });

  it("title por defecto es 'Error al cargar'", () => {
    render(<ErrorState />);
    expect(
      screen.getByRole("heading", { name: /error al cargar/i }),
    ).toBeInTheDocument();
  });

  it("acepta title y message custom", () => {
    render(<ErrorState title="Falló todo" message="500 boom" />);
    expect(screen.getByText("Falló todo")).toBeInTheDocument();
    expect(screen.getByText("500 boom")).toBeInTheDocument();
  });

  it("sin onRetry: NO pinta el boton", () => {
    render(<ErrorState message="x" />);
    expect(screen.queryByRole("button", { name: /reintentar/i })).toBeNull();
  });

  it("con onRetry: pinta el boton y lo invoca al hacer click", async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="x" onRetry={onRetry} />);
    const btn = screen.getByRole("button", { name: /reintentar/i });
    await userEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
