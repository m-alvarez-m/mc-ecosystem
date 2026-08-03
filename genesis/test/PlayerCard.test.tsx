import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerCard } from "../src/features/players";
import type { TopPlayer } from "../src/api/topPlayers";

const PLAYER: TopPlayer = {
  uuid: "71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
  name: "Vancorbus",
  count: "12500",
};

describe("PlayerCard", () => {
  it("renderiza nombre + uuid corto + total formateado", () => {
    render(<PlayerCard player={PLAYER} onOpen={() => undefined} />);
    expect(screen.getByText("Vancorbus")).toBeInTheDocument();
    expect(screen.getByText("#71804e99")).toBeInTheDocument();
    expect(screen.getByText("12.500")).toBeInTheDocument();
  });

  it("expone data-player-uuid en el contenedor Card", () => {
    const { container } = render(
      <PlayerCard player={PLAYER} onOpen={() => undefined} />,
    );
    const el = container.querySelector<HTMLElement>(
      `[data-player-uuid="${PLAYER.uuid}"]`,
    );
    expect(el).not.toBeNull();
  });

  it("titulo del uuid corto muestra el UUID completo (accesible)", () => {
    render(<PlayerCard player={PLAYER} onOpen={() => undefined} />);
    const short = screen.getByText("#71804e99");
    expect(short.getAttribute("title")).toBe(PLAYER.uuid);
  });

  it("boton 'Ver detalles' invoca onOpen con el uuid del jugador", async () => {
    const onOpen = vi.fn();
    render(<PlayerCard player={PLAYER} onOpen={onOpen} />);
    const btn = screen.getByRole("button", {
      name: /ver detalles de vancorbus/i,
    });
    await userEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(PLAYER.uuid);
  });
});
