import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "../src/components";

// Tests del Card (D2). Contrato: renderiza <div>, muestra children,
// expone data-variant, respeta className adicional.

describe("Card", () => {
  it("renderiza children dentro de un <div>", () => {
    render(
      <Card>
        <span>hola</span>
      </Card>,
    );
    expect(screen.getByText("hola")).toBeInTheDocument();
  });

  it("variant por defecto es 'surface' y viaja como data-variant", () => {
    const { container } = render(<Card>x</Card>);
    const div = container.firstChild as HTMLElement;
    expect(div.tagName).toBe("DIV");
    expect(div).toHaveAttribute("data-variant", "surface");
  });

  it("variant 'elevated' propaga data-variant", () => {
    const { container } = render(<Card variant="elevated">x</Card>);
    const div = container.firstChild as HTMLElement;
    expect(div).toHaveAttribute("data-variant", "elevated");
  });

  it("className adicional se concatena sin borrar los internos", () => {
    const { container } = render(<Card className="mio">x</Card>);
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain("mio");
    expect(div.className.split(" ").length).toBeGreaterThan(1);
  });
});
