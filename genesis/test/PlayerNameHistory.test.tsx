import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlayerNameHistory } from "../src/features/players";

describe("PlayerNameHistory", () => {
  it("renderiza <ol> aria-label + un <li> por entrada", () => {
    render(
      <PlayerNameHistory
        entries={[
          { name: "OldName", seen_at: "2026-07-26T23:25:52Z" },
          { name: "NewName", seen_at: "2026-08-01T09:00:00Z" },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: /historial de nombres/i });
    expect(list.tagName).toBe("OL");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
  });

  it("orden invertido: nombre más reciente arriba", () => {
    render(
      <PlayerNameHistory
        entries={[
          { name: "OldName", seen_at: "2026-07-26T23:25:52Z" },
          { name: "NewName", seen_at: "2026-08-01T09:00:00Z" },
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]!.getAttribute("data-name")).toBe("NewName");
    expect(items[1]!.getAttribute("data-name")).toBe("OldName");
  });

  it("<time datetime> con el ISO original", () => {
    const { container } = render(
      <PlayerNameHistory
        entries={[{ name: "X", seen_at: "2026-08-01T09:00:00Z" }]}
      />,
    );
    const t = container.querySelector("time")!;
    expect(t.getAttribute("datetime")).toBe("2026-08-01T09:00:00Z");
  });
});
