import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { App } from "../src/App";
import { Home } from "../src/pages/Home";

// Smoke test end-to-end de la aplicacion (evolucion D1 → D3).
//
// D1 pintaba <pre>{JSON}</pre>. D3 pinta el Overview con Cards. Los
// tests verifican la MISMA cadena (mount + fetch + TanStack Query +
// render), ahora contra la nueva UI:
//   - loading state visible antes de resolver
//   - despues de resolver: 1 card por insight, con titulo, categoria,
//     confidence badge y una entrada del listado accesible role=listitem
//   - fetch invocado contra /api/insight/insights con la ventana
//     desde ADR-007
//   - error HTTP → ErrorState con boton Reintentar; onRetry re-lanza
//     la query

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

describe("Genesis · smoke (D3)", () => {
  beforeEach(() => {
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
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => "not found",
        } as unknown as Response;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("monta y muestra el loading state antes de resolver", () => {
    renderWithProviders();
    // El LoadingState pinta `<div role="status">` con la etiqueta
    // dentro. Buscamos por texto (accesible via aria-live) porque el
    // `name` accesible de role=status no siempre incluye el text
    // content en Testing Library.
    expect(screen.getByText(/cargando insights/i)).toBeInTheDocument();
  });

  it("resuelve la query y pinta una card por insight con titulo humano", async () => {
    renderWithProviders();
    await waitFor(() => {
      expect(screen.getByText("Tendencia de actividad")).toBeInTheDocument();
    });
    // Los 4 insights? En este test solo hay 2 en la muestra, pero
    // ambos deben aparecer con su titulo humano.
    expect(screen.getByText("Tendencia de exploración")).toBeInTheDocument();

    // La lista tiene role=list + 2 items role=listitem.
    const list = screen.getByRole("list", { name: /insights del ecosistema/i });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("cada card expone data-insight-id y su severity", async () => {
    const { container } = renderWithProviders();
    await waitFor(() => {
      expect(container.querySelector('[data-insight-id="activity-trend"]'))
        .not.toBeNull();
    });
    const activityCard = container.querySelector<HTMLElement>(
      '[data-insight-id="activity-trend"]',
    )!;
    expect(activityCard.querySelector('[data-severity="normal"]')).not.toBeNull();
    const explorationCard = container.querySelector<HTMLElement>(
      '[data-insight-id="exploration-trend"]',
    )!;
    expect(explorationCard.querySelector('[data-severity="critical"]'))
      .not.toBeNull();
  });

  it("confidence se muestra como Badge (no como porcentaje)", async () => {
    renderWithProviders();
    await waitFor(() => {
      expect(screen.getByText("Confianza alta")).toBeInTheDocument();
    });
    expect(screen.getByText("Confianza baja")).toBeInTheDocument();
    // Sin "%": D3 prohibe representar confidence como porcentaje.
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("fetch se llama contra /api/insight/insights con from=ADR-007", async () => {
    renderWithProviders();
    await waitFor(() => {
      expect(screen.getByText("Tendencia de actividad")).toBeInTheDocument();
    });
    const calls = (fetch as unknown as { mock: { calls: [unknown][] } }).mock
      .calls;
    expect(calls.length).toBeGreaterThan(0);
    const url = String(calls[0]![0]);
    expect(url).toContain("/api/insight/insights");
    expect(url).toContain("from=2026-07-26T23%3A25%3A52Z");
    expect(url).toContain("to=");
  });

  it("error HTTP muestra ErrorState reutilizable con boton Reintentar", async () => {
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
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/no se pudieron cargar los insights/i))
      .toBeInTheDocument();
    // Boton reintentar visible; al hacer click, fetch se re-invoca.
    const retry = screen.getByRole("button", { name: /reintentar/i });
    const callsBefore = (fetch as unknown as { mock: { calls: unknown[] } })
      .mock.calls.length;
    await userEvent.click(retry);
    await waitFor(() => {
      const callsAfter = (fetch as unknown as { mock: { calls: unknown[] } })
        .mock.calls.length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  it("cuando la API devuelve [] muestra EmptyState elegante", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => [],
        text: async () => "[]",
      }) as unknown as Response),
    );
    renderWithProviders();
    await waitFor(() => {
      expect(screen.getByText(/aún no hay insights/i)).toBeInTheDocument();
    });
  });
});
