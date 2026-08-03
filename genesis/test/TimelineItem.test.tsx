import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelineItem } from "../src/features/timeline";
import type { TimelineEvent } from "../src/api/timeline";

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: "42",
    event_uuid: "00000000-0000-4000-8000-000000000042",
    type: "server.start",
    v: 1,
    ts: "2026-08-02T07:00:00Z",
    received_at: "2026-08-02T07:00:00Z",
    player_uuid: null,
    world: null,
    x: null,
    y: null,
    z: null,
    data: {},
    ...overrides,
  };
}

describe("TimelineItem", () => {
  it("renderiza <li> con data-event-type y data-event-id", () => {
    const { container } = render(
      <ul>
        <TimelineItem event={makeEvent({ id: "99", type: "backup.done" })} />
      </ul>,
    );
    const li = container.querySelector("li")!;
    expect(li).toBeInTheDocument();
    expect(li.getAttribute("data-event-type")).toBe("backup.done");
    expect(li.getAttribute("data-event-id")).toBe("99");
  });

  it("pinta el titulo humano del evento", () => {
    render(
      <ul>
        <TimelineItem event={makeEvent({ type: "server.stop" })} />
      </ul>,
    );
    expect(screen.getByText("Servidor detenido")).toBeInTheDocument();
  });

  it("tipos sin formatter pintan el `type` crudo", () => {
    render(
      <ul>
        <TimelineItem event={makeEvent({ type: "tipo.desconocido" })} />
      </ul>,
    );
    expect(screen.getByText("tipo.desconocido")).toBeInTheDocument();
  });

  it("player_uuid !== null pinta el subtitulo con prefijo #", () => {
    render(
      <ul>
        <TimelineItem
          event={makeEvent({
            type: "session.start",
            player_uuid: "71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
          })}
        />
      </ul>,
    );
    expect(screen.getByText("Jugador se conectó")).toBeInTheDocument();
    expect(screen.getByText("#71804e99")).toBeInTheDocument();
  });

  it("player_uuid null NO pinta subtitulo", () => {
    const { container } = render(
      <ul>
        <TimelineItem event={makeEvent({ player_uuid: null })} />
      </ul>,
    );
    // El unico texto muted permitido son los meta (fecha). El subtitulo
    // usa monospace y NO debe existir.
    expect(container.textContent ?? "").not.toMatch(/#/);
  });

  it("pinta <time datetime> con el ISO original", () => {
    const { container } = render(
      <ul>
        <TimelineItem event={makeEvent({ ts: "2026-08-02T07:00:00Z" })} />
      </ul>,
    );
    const timeEl = container.querySelector("time")!;
    expect(timeEl.getAttribute("datetime")).toBe("2026-08-02T07:00:00Z");
    // El texto formateado debe contener año 2026 (Intl es-ES).
    expect(timeEl.textContent ?? "").toMatch(/2026/);
  });

  it("NO se pinta data, world ni coordenadas", () => {
    const { container } = render(
      <ul>
        <TimelineItem
          event={makeEvent({
            type: "block.break",
            world: "world",
            x: 100,
            y: 64,
            z: -200,
            data: { block: "minecraft:diamond_ore", tool: "netherite_pickaxe" },
          })}
        />
      </ul>,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/diamond_ore/);
    expect(text).not.toMatch(/netherite/);
    expect(text).not.toMatch(/-200/);
    expect(text).not.toMatch(/world/i);
  });

  it("icono decorativo tiene aria-hidden (el texto ya comunica)", () => {
    const { container } = render(
      <ul>
        <TimelineItem event={makeEvent({ type: "server.start" })} />
      </ul>,
    );
    const iconWrapper = container.querySelector('[data-category="server"]');
    expect(iconWrapper).not.toBeNull();
    expect(iconWrapper!.getAttribute("aria-hidden")).toBe("true");
  });
});
