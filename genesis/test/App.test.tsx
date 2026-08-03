import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { App } from "../src/App";
import { Home } from "../src/pages/Home";

// Smoke test end-to-end de la aplicacion (evolucion D1 → D3 → D4).
//
// D4 anadio el SummaryDashboard SOBRE el Overview. La pagina Home
// ahora consume TRES endpoints:
//   - GET /api/insight/insights   (Overview, D3)
//   - GET /api/insight/server     (Summary, D4)
//   - GET /api/insight/players    (Summary, D4)
//
// Los tests mockean los tres y verifican:
//   - loading visible al montar (loading de ambas secciones)
//   - despues de resolver: heading Dashboard (h1), Summary (h2),
//     Overview (h2); KPIs con numeros formateados; cards de insight
//     por debajo del Summary
//   - fetch invocado contra las 3 URLs esperadas
//   - error 500 en TODO → ambas secciones muestran ErrorState

function renderWithProviders() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<App />}>
            <Route index element={<Home />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const SAMPLE_INSIGHTS = [
  {
    id: "activity-trend",
    category: "activity",
    severity: "normal",
    confidence: "high",
    generatedAt: "2026-08-02T00:00:00Z",
    window: { from: "2026-07-26T23:25:52Z", to: "2026-08-02T00:00:00Z" },
    facts: { current: "42", previous: "40", ratio: 1.05, trend: "flat" },
    evidence: ["activity"],
    metadata: {
      engineVersion: "1.0",
      severityThresholds: { normal: 0.1, low: 0.25, high: 0.5 },
      confidenceThresholds: { medium: 10, high: 100 },
    },
  },
  {
    id: "exploration-trend",
    category: "exploration",
    severity: "critical",
    confidence: "low",
    generatedAt: "2026-08-02T00:00:00Z",
    window: { from: "2026-07-26T23:25:52Z", to: "2026-08-02T00:00:00Z" },
    facts: { currentChunks: "0", previousChunks: "5130", trend: "down" },
    evidence: ["exploration"],
    metadata: {
      engineVersion: "1.0",
      severityThresholds: { normal: 0.1, low: 0.25, high: 0.5 },
      confidenceThresholds: { medium: 10, high: 100 },
    },
  },
];

const SAMPLE_SERVER = {
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

const SAMPLE_PLAYERS = {
  totalPlayers: "2",
  activePlayers: "2",
  newPlayers: "1",
  returningPlayers: "1",
};

// D5: fixture del timeline. Los eventos vienen ASC del API; el
// componente los invierte para pintar el mas reciente arriba.
const SAMPLE_TIMELINE = [
  {
    id: "100",
    event_uuid: "00000000-0000-4000-8000-000000000100",
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
  },
  {
    id: "101",
    event_uuid: "00000000-0000-4000-8000-000000000101",
    type: "session.start",
    v: 1,
    ts: "2026-08-02T07:05:00Z",
    received_at: "2026-08-02T07:05:00Z",
    player_uuid: "71804e99-f2aa-32dc-bfcb-0ea5cfdda708",
    world: null,
    x: null,
    y: null,
    z: null,
    data: {},
  },
];

function stubFetchAll(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/insight/insights")) {
        return {
          ok: true,
          status: 200,
          json: async () => SAMPLE_INSIGHTS,
          text: async () => JSON.stringify(SAMPLE_INSIGHTS),
        } as unknown as Response;
      }
      if (url.includes("/api/insight/server")) {
        return {
          ok: true,
          status: 200,
          json: async () => SAMPLE_SERVER,
          text: async () => JSON.stringify(SAMPLE_SERVER),
        } as unknown as Response;
      }
      if (url.includes("/api/insight/players")) {
        return {
          ok: true,
          status: 200,
          json: async () => SAMPLE_PLAYERS,
          text: async () => JSON.stringify(SAMPLE_PLAYERS),
        } as unknown as Response;
      }
      if (url.includes("/api/insight/events/timeline")) {
        return {
          ok: true,
          status: 200,
          json: async () => SAMPLE_TIMELINE,
          text: async () => JSON.stringify(SAMPLE_TIMELINE),
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

describe("Genesis · smoke (D4)", () => {
  beforeEach(() => {
    stubFetchAll();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("monta y muestra loading states de ambas secciones", () => {
    renderWithProviders();
    // Overview muestra "Cargando insights…"; Summary muestra
    // "Cargando resumen…". Ambos deben ser visibles antes de que
    // ninguna query resuelva.
    expect(screen.getByText(/cargando resumen/i)).toBeInTheDocument();
    expect(screen.getByText(/cargando insights/i)).toBeInTheDocument();
  });

  it("jerarquia de headings: h1 Dashboard, h2 Summary, h2 Overview", async () => {
    renderWithProviders();
    // El h1 se pinta en cuanto Home monta.
    expect(
      screen.getByRole("heading", { level: 1, name: /dashboard/i }),
    ).toBeInTheDocument();
    // Los h2 requieren esperar el mount de sus secciones.
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 2, name: /^summary$/i }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("heading", { level: 2, name: /^overview$/i }),
    ).toBeInTheDocument();
  });

  it("Summary pinta los 8 KPIs esperados con datos reales", async () => {
    renderWithProviders();
    await waitFor(() => {
      expect(screen.getByTestId("summary-grid")).toBeInTheDocument();
    });
    const grid = screen.getByTestId("summary-grid");
    // 8 KPIs (cada uno con role=group).
    const kpis = within(grid).getAllByRole("group");
    expect(kpis).toHaveLength(8);
    // Valores formateados con separador de miles (es-ES usa punto).
    expect(within(grid).getByText("14.115")).toBeInTheDocument();
    expect(within(grid).getByText("29")).toBeInTheDocument();
    // Labels obligatorias.
    expect(within(grid).getByText(/total events/i)).toBeInTheDocument();
    expect(within(grid).getByText(/distinct event types/i)).toBeInTheDocument();
    expect(within(grid).getByText(/first event/i)).toBeInTheDocument();
    expect(within(grid).getByText(/last event/i)).toBeInTheDocument();
    expect(within(grid).getByText(/total players/i)).toBeInTheDocument();
    expect(within(grid).getByText(/active players/i)).toBeInTheDocument();
    expect(within(grid).getByText(/new players/i)).toBeInTheDocument();
    expect(within(grid).getByText(/returning players/i)).toBeInTheDocument();
  });

  it("Overview sigue pintando una card por insight (D3 no roto)", async () => {
    renderWithProviders();
    await waitFor(() => {
      expect(screen.getByText("Tendencia de actividad")).toBeInTheDocument();
    });
    expect(screen.getByText("Tendencia de exploración")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: /insights del ecosistema/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("Summary se pinta ANTES del Overview en el orden del DOM", async () => {
    const { container } = renderWithProviders();
    await waitFor(() => {
      expect(container.querySelector('[data-testid="summary-grid"]'))
        .not.toBeNull();
    });
    // La sección Summary (con aria-label del heading id-generado) va
    // antes que la lista de insights.
    const summaryGrid = container.querySelector('[data-testid="summary-grid"]')!;
    const overviewList = container.querySelector(
      '[role="list"][aria-label*="Insights del ecosistema"]',
    )!;
    expect(overviewList).not.toBeNull();
    const position = summaryGrid.compareDocumentPosition(overviewList);
    // Node.DOCUMENT_POSITION_FOLLOWING = 4
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("fetch se llama contra las 3 rutas esperadas", async () => {
    renderWithProviders();
    await waitFor(() => {
      expect(screen.getByText("Tendencia de actividad")).toBeInTheDocument();
    });
    const calls = (fetch as unknown as { mock: { calls: [unknown][] } }).mock
      .calls;
    const urls = calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/insight/insights"))).toBe(true);
    expect(urls.some((u) => u.includes("/api/insight/server"))).toBe(true);
    expect(
      urls.some(
        (u) =>
          u.includes("/api/insight/players") &&
          u.includes("from=2026-07-26T23%3A25%3A52Z"),
      ),
    ).toBe(true);
  });

  it("error HTTP en TODAS las APIs: las tres secciones muestran alert + Reintentar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => "boom",
      }) as unknown as Response),
    );
    renderWithProviders();
    await waitFor(() => {
      // D5: Summary + Overview + Timeline → 3 secciones con ErrorState.
      expect(screen.getAllByRole("alert")).toHaveLength(3);
    });
    expect(
      screen.getByText(/no se pudieron cargar los insights/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no se pudo cargar el resumen/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no se pudo cargar el timeline/i),
    ).toBeInTheDocument();
    // 3 botones Reintentar (uno por seccion).
    const retryBtns = screen.getAllByRole("button", { name: /reintentar/i });
    expect(retryBtns).toHaveLength(3);
    const callsBefore = (fetch as unknown as { mock: { calls: unknown[] } })
      .mock.calls.length;
    await userEvent.click(retryBtns[0]!);
    await waitFor(() => {
      const callsAfter = (fetch as unknown as { mock: { calls: unknown[] } })
        .mock.calls.length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  it("Overview con []: EmptyState propio del Overview visible", async () => {
    // Overrides puntuales: insights [], resto OK. Asi el Summary
    // sigue mostrando KPIs y el Overview su EmptyState.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("/api/insight/insights")) {
          return {
            ok: true,
            status: 200,
            json: async () => [],
            text: async () => "[]",
          } as unknown as Response;
        }
        if (url.includes("/api/insight/server")) {
          return {
            ok: true,
            status: 200,
            json: async () => SAMPLE_SERVER,
            text: async () => JSON.stringify(SAMPLE_SERVER),
          } as unknown as Response;
        }
        if (url.includes("/api/insight/players")) {
          return {
            ok: true,
            status: 200,
            json: async () => SAMPLE_PLAYERS,
            text: async () => JSON.stringify(SAMPLE_PLAYERS),
          } as unknown as Response;
        }
        if (url.includes("/api/insight/events/timeline")) {
          return {
            ok: true,
            status: 200,
            json: async () => SAMPLE_TIMELINE,
            text: async () => JSON.stringify(SAMPLE_TIMELINE),
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
    renderWithProviders();
    await waitFor(() => {
      expect(screen.getByText(/aún no hay insights/i)).toBeInTheDocument();
    });
    // El Summary sigue sano.
    expect(screen.getByTestId("summary-grid")).toBeInTheDocument();
    // El Timeline también.
    expect(screen.getByTestId("timeline-list")).toBeInTheDocument();
  });

  it("Timeline se pinta como tercera seccion (D5)", async () => {
    renderWithProviders();
    await waitFor(() => {
      expect(screen.getByTestId("timeline-list")).toBeInTheDocument();
    });
    // Heading h2 Timeline visible.
    expect(
      screen.getByRole("heading", { level: 2, name: /^timeline$/i }),
    ).toBeInTheDocument();
    // 2 items en la muestra.
    const list = screen.getByTestId("timeline-list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    // Titulos humanos aplicados.
    expect(within(list).getByText("Servidor iniciado")).toBeInTheDocument();
    expect(within(list).getByText("Jugador se conectó")).toBeInTheDocument();
    // Orden: mas reciente arriba. session.start (07:05) va antes que
    // server.start (07:00) en el DOM.
    const items = within(list).getAllByRole("listitem");
    expect(items[0]!.getAttribute("data-event-type")).toBe("session.start");
    expect(items[1]!.getAttribute("data-event-type")).toBe("server.start");
  });

  it("fetch al timeline con limit=20 y ventana ISO", async () => {
    renderWithProviders();
    await waitFor(() => {
      expect(screen.getByTestId("timeline-list")).toBeInTheDocument();
    });
    const calls = (fetch as unknown as { mock: { calls: [unknown][] } }).mock
      .calls;
    const timelineUrl = calls
      .map((c) => String(c[0]))
      .find((u) => u.includes("/api/insight/events/timeline"));
    expect(timelineUrl).toBeDefined();
    expect(timelineUrl).toContain("limit=20");
    expect(timelineUrl).toMatch(/from=\d{4}-\d{2}-\d{2}T/);
    expect(timelineUrl).toMatch(/to=\d{4}-\d{2}-\d{2}T/);
  });
});
