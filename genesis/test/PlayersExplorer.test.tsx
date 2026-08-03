import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlayersExplorer } from "../src/features/players";

// Tests focalizados del PlayersExplorer (D6). Verifican:
//   - heading h2 "Players"
//   - loading -> LoadingState
//   - [] -> EmptyState "Sin jugadores conocidos aún" y NO grid
//   - success -> grid con una card por jugador (role=list/listitem)
//   - request contract: limit=20 + rango ISO desde ADR-007
//   - error -> ErrorState + Reintentar
//   - abrir drawer: clic en "Ver detalles" dispara /player/:uuid;
//     cerrar con "Cerrar" desmonta el drawer

const TOP_TWO = [
  { uuid: "71804e99-f2aa-32dc-bfcb-0ea5cfdda708", name: "Vancorbus", count: "12500" },
  { uuid: "8a80a72d-fb01-3e17-9a96-2b801d16f82d", name: "Elrid", count: "800" },
];

const PLAYER_INSIGHT = {
  uuid: "71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
  name: "Vancorbus",
  nameHistory: [{ name: "Vancorbus", seen_at: "2026-07-26T23:26:00Z" }],
  firstEvent: {
    id: "1",
    event_uuid: "00000000-0000-4000-8000-000000000001",
    type: "session.start",
    ts: "2026-07-26T23:26:00Z",
  },
  lastEvent: null,
  totalEvents: "12500",
  eventsByType: [{ type: "session.start", count: "12" }],
};

function stubFetchByPath(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/insight/players/top")) {
        return {
          ok: true,
          status: 200,
          json: async () => TOP_TWO,
          text: async () => JSON.stringify(TOP_TWO),
        } as unknown as Response;
      }
      if (url.includes("/api/insight/player/")) {
        return {
          ok: true,
          status: 200,
          json: async () => PLAYER_INSIGHT,
          text: async () => JSON.stringify(PLAYER_INSIGHT),
        } as unknown as Response;
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => "not found",
      } as unknown as Response;
    }),
  );
}

function renderIt() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PlayersExplorer />
    </QueryClientProvider>,
  );
}

describe("PlayersExplorer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.style.overflow = "";
  });

  describe("loading", () => {
    beforeEach(() => {
      stubFetchByPath();
    });

    it("pinta LoadingState 'Cargando jugadores…' + heading h2 Players", () => {
      renderIt();
      expect(screen.getByText(/cargando jugadores/i)).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 2, name: /^players$/i }),
      ).toBeInTheDocument();
    });
  });

  describe("success", () => {
    beforeEach(() => {
      stubFetchByPath();
    });

    it("pinta grid con una card por jugador (role=list + listitem)", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByTestId("players-grid")).toBeInTheDocument();
      });
      const grid = screen.getByTestId("players-grid");
      expect(grid.tagName).toBe("UL");
      const items = within(grid).getAllByRole("listitem");
      expect(items).toHaveLength(2);
      expect(within(grid).getByText("Vancorbus")).toBeInTheDocument();
      expect(within(grid).getByText("Elrid")).toBeInTheDocument();
    });

    it("request contract: limit=20 + rango ISO desde ADR-007", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByTestId("players-grid")).toBeInTheDocument();
      });
      const calls = (fetch as unknown as { mock: { calls: [unknown][] } })
        .mock.calls;
      const url = String(calls[0]![0]);
      expect(url).toContain("/api/insight/players/top");
      expect(url).toContain("limit=20");
      expect(url).toContain("from=2026-07-26T23%3A25%3A52Z");
      expect(url).toMatch(/to=\d{4}-\d{2}-\d{2}T/);
    });

    it("clic en 'Ver detalles' abre el Drawer y dispara /player/:uuid", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByTestId("players-grid")).toBeInTheDocument();
      });
      await userEvent.click(
        screen.getByRole("button", { name: /ver detalles de vancorbus/i }),
      );
      // Drawer visible.
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
      // Fetch a /player/:uuid disparado.
      await waitFor(() => {
        const calls = (fetch as unknown as { mock: { calls: [unknown][] } })
          .mock.calls;
        expect(
          calls.some((c) =>
            String(c[0]).includes(
              "/api/insight/player/71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
            ),
          ),
        ).toBe(true);
      });
      // Body scroll bloqueado.
      expect(document.body.style.overflow).toBe("hidden");
    });

    it("cerrar drawer desmonta el dialogo y restaura scroll", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByTestId("players-grid")).toBeInTheDocument();
      });
      await userEvent.click(
        screen.getByRole("button", { name: /ver detalles de vancorbus/i }),
      );
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
      await userEvent.click(
        screen.getByRole("button", { name: /cerrar detalle/i }),
      );
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      expect(document.body.style.overflow).toBe("");
    });

    it("abrir otro jugador: refetch al segundo uuid", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByTestId("players-grid")).toBeInTheDocument();
      });
      // Abrir primero.
      await userEvent.click(
        screen.getByRole("button", { name: /ver detalles de vancorbus/i }),
      );
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
      // Cerrar y abrir el otro.
      await userEvent.click(
        screen.getByRole("button", { name: /cerrar detalle/i }),
      );
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      await userEvent.click(
        screen.getByRole("button", { name: /ver detalles de elrid/i }),
      );
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
      await waitFor(() => {
        const calls = (fetch as unknown as { mock: { calls: [unknown][] } })
          .mock.calls;
        expect(
          calls.some((c) =>
            String(c[0]).includes(
              "/api/insight/player/8a80a72d-fb01-3e17-9a96-2b801d16f82d",
            ),
          ),
        ).toBe(true);
      });
    });
  });

  describe("empty", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => [],
          text: async () => "[]",
        }) as unknown as Response),
      );
    });

    it("[] pinta EmptyState 'Sin jugadores conocidos' y NO grid", async () => {
      renderIt();
      await waitFor(() => {
        expect(
          screen.getByText(/sin jugadores conocidos aún/i),
        ).toBeInTheDocument();
      });
      expect(screen.queryByTestId("players-grid")).toBeNull();
    });
  });

  describe("error", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: false,
          status: 500,
          json: async () => ({}),
          text: async () => "boom",
        }) as unknown as Response),
      );
    });

    it("500 -> ErrorState role=alert + boton Reintentar", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
      expect(
        screen.getByText(/no se pudo cargar la lista de jugadores/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /reintentar/i }),
      ).toBeInTheDocument();
    });
  });
});
