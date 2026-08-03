import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../src/components";

// Tests del Button (D2). No verificamos ESTILOS visuales — verificamos
// contrato: renderiza <button>, propaga onClick, respeta disabled,
// data-attrs correctos, type default a "button".

describe("Button", () => {
  it("renderiza como <button> con el texto pasado como children", () => {
    render(<Button>Guardar</Button>);
    const btn = screen.getByRole("button", { name: "Guardar" });
    expect(btn.tagName).toBe("BUTTON");
  });

  it("type por defecto es 'button' (evita submit accidental en <form>)", () => {
    render(<Button>Guardar</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("propaga onClick al hacer click", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Clic</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disabled: no dispara onClick y expone atributo", async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Clic
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("variant y size viajan como data-attributes (aislables por tests futuros)", () => {
    render(
      <Button variant="danger" size="lg">
        Borrar
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("data-variant", "danger");
    expect(btn).toHaveAttribute("data-size", "lg");
  });

  it("acepta type='submit' explicito", () => {
    render(<Button type="submit">Enviar</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("acepta className adicional sin borrar los internos", () => {
    render(<Button className="mio">X</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("mio");
    // Un class del modulo tambien debe estar presente (nombre hasheado).
    expect(btn.className.split(" ").length).toBeGreaterThan(1);
  });
});
