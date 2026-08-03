import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Timeline } from "../src/features/timeline";
import type { TimelineEvent } from "../src/api/timeline";

// Tests focalizados del Timeline (D5). Sin router.
//
// Escenarios:
//   - loading -> LoadingState visible
//   - success con eventos -> <ol> con role=list + N listitems, mas
//     reciente arriba (orden invertido respecto al API)
//   - success con [] -> EmptyState 'Sin actividad reciente'
//   - error -> ErrorState + Reintentar

function renderIt() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Timeline />
    </QueryClientProvider>,
  );
}

function ev(overrides: Partial<TimelineEvent>): TimelineEvent {
  return {
    id: "1",
    event_uuid: "00000000-0000-4000-8000-000000000001",
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

// API entrega ASC (mas antiguo primero). Fixture con 3 eventos.
const TIMELINE_ASC: TimelineEvent[] = [
  ev({
    id: "1",
    event_uuid: "00000000-0000-4000-8000-000000000001",
    type: "server.start",
    ts: "2026-08-02T06:00:00Z",
  }),
  ev({
    id: "2",
    event_uuid: "00000000-0000-4000-8000-000000000002",
    type: "session.start",
    ts: "2026-08-02T06:30:00Z",
    player_uuid: "71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
  }),
  ev({
    id: "3",
    event_uuid: "00000000-0000-4000-8000-000000000003",
    type: "backup.done",
    ts: "2026-08-02T07:00:00Z",
  }),
];

function stub(
  response:
    | { ok: true; body: unknown }
    | { ok: false; status: number; body: string },
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (response.ok) {
        return {
          ok: true,
          status: 200,
          json: async () => response.body,
          text: async () => JSON.stringify(response.body),
        } as unknown as Response;
      }
      return {
        ok: false,
        status: response.status,
        json: async () => ({}),
        text: async () => response.body,
      } as unknown as Response;
    }),
  );
}

describe("Timeline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("loading", () => {
    beforeEach(() => {
      stub({ ok: true, body: TIMELINE_ASC });
    });

    it("pinta LoadingState 'Cargando timeline…'", () => {
      renderIt();
      expect(screen.getByText(/cargando timeline/i)).toBeInTheDocument();
    });

    it("headings semanticos: h2 'Timeline'", () => {
      renderIt();
      expect(
        screen.getByRole("heading", { level: 2, name: /^timeline$/i }),
      ).toBeInTheDocument();
    });
  });

  describe("success", () => {
    beforeEach(() => {
      stub({ ok: true, body: TIMELINE_ASC });
    });

    it("pinta <ol> con role=list y un <li> por evento", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByTestId("timeline-list")).toBeInTheDocument();
      });
      const list = screen.getByTestId("timeline-list");
      expect(list.tagName).toBe("OL");
      const items = within(list).getAllByRole("listitem");
      expect(items).toHaveLength(3);
    });

    it("orden invertido: mas reciente arriba (id 3, 2, 1)", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByTestId("timeline-list")).toBeInTheDocument();
      });
      const items = within(screen.getByTestId("timeline-list"))
        .getAllByRole("listitem");
      expect(items[0]!.getAttribute("data-event-id")).toBe("3");
      expect(items[1]!.getAttribute("data-event-id")).toBe("2");
      expect(items[2]!.getAttribute("data-event-id")).toBe("1");
    });

    it("titulos humanos por tipo (server.start, session.start, backup.done)", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByTestId("timeline-list")).toBeInTheDocument();
      });
      expect(screen.getByText("Respaldo completado")).toBeInTheDocument();
      expect(screen.getByText("Jugador se conectó")).toBeInTheDocument();
      expect(screen.getByText("Servidor iniciado")).toBeInTheDocument();
    });

    it("subtitulo #<uuid_8> aparece solo para eventos con player_uuid", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByTestId("timeline-list")).toBeInTheDocument();
      });
      expect(screen.getByText("#71804e99")).toBeInTheDocument();
    });
  });

  describe("empty", () => {
    beforeEach(() => {
      stub({ ok: true, body: [] });
    });

    it("array vacio pinta EmptyState 'Sin actividad reciente'", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByText(/sin actividad reciente/i)).toBeInTheDocument();
      });
      // El <ol> del timeline NO debe existir.
      expect(screen.queryByTestId("timeline-list")).toBeNull();
    });
  });

  describe("error", () => {
    it("500 -> ErrorState role=alert + boton Reintentar", async () => {
      stub({ ok: false, status: 500, body: "boom" });
      renderIt();
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
      expect(
        screen.getByText(/no se pudo cargar el timeline/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /reintentar/i }),
      ).toBeInTheDocument();
    });
  });

  describe("request contract", () => {
    it("emite fetch a /api/insight/events/timeline con limit=20", async () => {
      stub({ ok: true, body: TIMELINE_ASC });
      renderIt();
      await waitFor(() => {
        expect(screen.getByTestId("timeline-list")).toBeInTheDocument();
      });
      const calls = (fetch as unknown as { mock: { calls: [unknown][] } })
        .mock.calls;
      const url = String(calls[0]![0]);
      expect(url).toContain("/api/insight/events/timeline");
      expect(url).toContain("limit=20");
      expect(url).toMatch(/from=\d{4}-\d{2}-\d{2}T/);
      expect(url).toMatch(/to=\d{4}-\d{2}-\d{2}T/);
    });
  });
});
