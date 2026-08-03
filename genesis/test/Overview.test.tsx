import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Overview } from "../src/features/overview";

// Tests focalizados de la pantalla Overview (D3), sin router.
//
// Escenarios cubiertos:
//   - loading -> LoadingState visible
//   - success con lista -> heading "Overview", una card por insight,
//     lista accesible role=list
//   - success con [] -> EmptyState con titulo esperado
//   - error -> ErrorState con boton Reintentar

function renderOverview() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Overview />
    </QueryClientProvider>,
  );
}

const TWO_INSIGHTS = [
  {
    id: "activity-trend",
    category: "activity",
    severity: "normal",
    confidence: "high",
    generatedAt: "2026-08-02T00:00:00Z",
    window: { from: "2026-07-26T23:25:52Z", to: "2026-08-02T00:00:00Z" },
    facts: { currentEvents: "42" },
    evidence: ["activitySignal"],
    metadata: {
      engineVersion: "1.0",
      severityThresholds: {},
      confidenceThresholds: {},
    },
  },
  {
    id: "economy-focus",
    category: "economy",
    severity: "low",
    confidence: "medium",
    generatedAt: "2026-08-02T00:00:00Z",
    window: { from: "2026-07-26T23:25:52Z", to: "2026-08-02T00:00:00Z" },
    facts: { dominantShare: 0.6 },
    evidence: ["economySignal"],
    metadata: {
      engineVersion: "1.0",
      severityThresholds: {},
      confidenceThresholds: {},
    },
  },
];

function stubFetch(
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

describe("Overview", () => {
  beforeEach(() => {
    stubFetch({ ok: true, body: TWO_INSIGHTS });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pinta el heading 'Overview' y la ventana temporal", async () => {
    renderOverview();
    // Heading nivel 1 con visualSize=xl.
    expect(
      screen.getByRole("heading", { level: 1, name: /overview/i }),
    ).toBeInTheDocument();
    // La ventana aparece en el subtitle con el sufijo "Ventana:".
    expect(screen.getByText(/ventana:/i)).toBeInTheDocument();
  });

  it("loading state visible antes de resolver la query", () => {
    renderOverview();
    expect(screen.getByText(/cargando insights/i)).toBeInTheDocument();
  });

  it("success: pinta una card por insight y expone lista accesible", async () => {
    renderOverview();
    await waitFor(() => {
      expect(screen.getByText("Tendencia de actividad")).toBeInTheDocument();
    });
    expect(screen.getByText("Foco económico")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: /insights del ecosistema/i });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("success con [] pinta EmptyState 'Aún no hay insights'", async () => {
    stubFetch({ ok: true, body: [] });
    renderOverview();
    await waitFor(() => {
      expect(screen.getByText(/aún no hay insights/i)).toBeInTheDocument();
    });
    // El grid de cards NO debe pintarse cuando la lista esta vacia.
    expect(screen.queryByRole("list", { name: /insights del ecosistema/i }))
      .toBeNull();
  });

  it("error: pinta ErrorState con role=alert y boton Reintentar", async () => {
    stubFetch({ ok: false, status: 500, body: "boom" });
    renderOverview();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/no se pudieron cargar los insights/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });
});
