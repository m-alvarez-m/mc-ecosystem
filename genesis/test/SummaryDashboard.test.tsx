import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SummaryDashboard } from "../src/features/summary";

// Tests focalizados del SummaryDashboard (D4). Sin router.
//
// Escenarios:
//   - loading -> LoadingState visible
//   - success con datos -> 8 KpiCard con labels + values esperados
//   - success con totalEvents=0 -> EmptyState 'Sin datos aún'
//   - error en cualquiera de las 2 queries -> ErrorState + Reintentar

function renderIt() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SummaryDashboard />
    </QueryClientProvider>,
  );
}

const SERVER = {
  firstEvent: {
    id: "1",
    event_uuid: "00000000-0000-4000-8000-000000000001",
    type: "server.start",
    ts: "2026-07-26T23:25:52Z",
  },
  lastEvent: {
    id: "14115",
    event_uuid: "00000000-0000-4000-8000-000000014115",
    type: "server.tps_sample",
    ts: "2026-08-02T07:28:33Z",
  },
  totalEvents: "14115",
  distinctTypes: "29",
  latestId: "14115",
  timeRangeStart: "2026-07-26T23:25:52Z",
  timeRangeEnd: "2026-08-02T07:28:33Z",
};

const PLAYERS = {
  totalPlayers: "2",
  activePlayers: "2",
  newPlayers: "1",
  returningPlayers: "1",
};

interface FetchMap {
  server?: unknown | { fail: true };
  players?: unknown | { fail: true };
}

function stubFetch(map: FetchMap): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const target = url.includes("/api/insight/server")
        ? map.server
        : url.includes("/api/insight/players")
          ? map.players
          : undefined;
      if (target === undefined) {
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => "not found",
        } as unknown as Response;
      }
      if (
        typeof target === "object" &&
        target !== null &&
        "fail" in target &&
        (target as { fail: true }).fail
      ) {
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
          text: async () => "boom",
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => target,
        text: async () => JSON.stringify(target),
      } as unknown as Response;
    }),
  );
}

describe("SummaryDashboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("loading", () => {
    beforeEach(() => {
      stubFetch({ server: SERVER, players: PLAYERS });
    });

    it("pinta LoadingState mientras alguna query esta pendiente", () => {
      renderIt();
      expect(screen.getByText(/cargando resumen/i)).toBeInTheDocument();
    });

    it("headings semanticos: h2 'Summary'", () => {
      renderIt();
      expect(
        screen.getByRole("heading", { level: 2, name: /^summary$/i }),
      ).toBeInTheDocument();
    });
  });

  describe("success", () => {
    beforeEach(() => {
      stubFetch({ server: SERVER, players: PLAYERS });
    });

    it("pinta los 8 KPIs esperados con values formateados", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByTestId("summary-grid")).toBeInTheDocument();
      });
      const grid = screen.getByTestId("summary-grid");
      const groups = within(grid).getAllByRole("group");
      expect(groups).toHaveLength(8);

      // Labels obligatorias
      expect(within(grid).getByText(/^total events$/i)).toBeInTheDocument();
      expect(within(grid).getByText(/^distinct event types$/i)).toBeInTheDocument();
      expect(within(grid).getByText(/^first event$/i)).toBeInTheDocument();
      expect(within(grid).getByText(/^last event$/i)).toBeInTheDocument();
      expect(within(grid).getByText(/^total players$/i)).toBeInTheDocument();
      expect(within(grid).getByText(/^active players$/i)).toBeInTheDocument();
      expect(within(grid).getByText(/^new players$/i)).toBeInTheDocument();
      expect(within(grid).getByText(/^returning players$/i)).toBeInTheDocument();

      // Numeros formateados
      expect(within(grid).getByText("14.115")).toBeInTheDocument(); // totalEvents
      expect(within(grid).getByText("29")).toBeInTheDocument();     // distinctTypes
      // Multiples "2" (totalPlayers + activePlayers): usamos getAllByText.
      expect(within(grid).getAllByText("2").length).toBeGreaterThanOrEqual(2);

      // Hints: tipo del primer y ultimo evento
      expect(within(grid).getByText("server.start")).toBeInTheDocument();
      expect(within(grid).getByText("server.tps_sample")).toBeInTheDocument();
    });

    it("first/last event pintan valor 'compact' cuando existen", async () => {
      const { container } = renderIt();
      await waitFor(() => {
        expect(screen.getByTestId("summary-grid")).toBeInTheDocument();
      });
      // Al menos dos KpiCard son compact (first + last event).
      const compacts = container.querySelectorAll('[data-value-size="compact"]');
      expect(compacts.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("empty", () => {
    beforeEach(() => {
      stubFetch({
        server: { ...SERVER, totalEvents: "0", firstEvent: null, lastEvent: null },
        players: PLAYERS,
      });
    });

    it("totalEvents=0 pinta EmptyState 'Sin datos aún' y NO pinta el grid", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByText(/sin datos aún/i)).toBeInTheDocument();
      });
      expect(screen.queryByTestId("summary-grid")).toBeNull();
    });
  });

  describe("error", () => {
    it("fallo del /insight/server pinta ErrorState + boton Reintentar", async () => {
      stubFetch({ server: { fail: true }, players: PLAYERS });
      renderIt();
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
      expect(
        screen.getByText(/no se pudo cargar el resumen/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /reintentar/i }),
      ).toBeInTheDocument();
    });

    it("fallo del /insight/players tambien lo dispara", async () => {
      stubFetch({ server: SERVER, players: { fail: true } });
      renderIt();
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
    });
  });
});
