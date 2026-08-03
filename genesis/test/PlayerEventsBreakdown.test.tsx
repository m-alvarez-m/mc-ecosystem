import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PlayerEventsBreakdown } from "../src/features/players";

describe("PlayerEventsBreakdown", () => {
  it("renderiza <dl> con aria-label", () => {
    const { container } = render(
      <PlayerEventsBreakdown
        entries={[
          { type: "session.start", count: "42" },
          { type: "block.break", count: "1234" },
        ]}
      />,
    );
    const dl = container.querySelector("dl")!;
    expect(dl).toBeInTheDocument();
    expect(dl.getAttribute("aria-label")).toMatch(
      /distribución de eventos por tipo/i,
    );
  });

  it("pinta type (tal cual) + count formateado con grouping", () => {
    render(
      <PlayerEventsBreakdown
        entries={[
          { type: "session.start", count: "42" },
          { type: "block.break", count: "1234" },
        ]}
      />,
    );
    expect(screen.getByText("session.start")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("block.break")).toBeInTheDocument();
    expect(screen.getByText("1.234")).toBeInTheDocument();
  });

  it("preserva el orden recibido de la API (DESC por count)", () => {
    const { container } = render(
      <PlayerEventsBreakdown
        entries={[
          { type: "position.sample", count: "9000" },
          { type: "block.break", count: "1000" },
          { type: "session.start", count: "10" },
        ]}
      />,
    );
    const dts = [...container.querySelectorAll("dt")].map((el) =>
      el.getAttribute("data-type"),
    );
    expect(dts).toEqual(["position.sample", "block.break", "session.start"]);
  });

  it("lista vacía: dl sin filas", () => {
    const { container } = render(<PlayerEventsBreakdown entries={[]} />);
    const dl = container.querySelector("dl")!;
    expect(within(dl).queryAllByRole("term")).toHaveLength(0);
  });
});
