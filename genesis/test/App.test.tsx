import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { App } from "../src/App";
import { Home } from "../src/pages/Home";

// Smoke test de D1.
//
// Verifica:
//   1. La aplicacion monta sin lanzar.
//   2. TanStack Query recibe una respuesta mockeada de fetch.
//   3. El JSON crudo se pinta en el DOM (proof-of-life).
//
// No prueba estilos, ni rutas complejas, ni error boundaries. El
// alcance es demostrar que el pipeline React + Query + fetch esta
// vivo y consumible desde el arbol del componente.

function renderWithProviders() {
  // QueryClient nuevo por test: sin retries (para que un fetch fallado
  // se traduzca en error inmediatamente en el DOM) y sin cache
  // compartida entre tests.
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
];

describe("Genesis · D1 · smoke", () => {
  beforeEach(() => {
    // Mock global.fetch para todos los tests de este describe. Se usa
    // un objeto plano en lugar de `new Response(...)` porque el
    // environment jsdom no siempre trae la clase Response global.
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

  it("la aplicacion monta y muestra el estado de carga inicial", () => {
    renderWithProviders();
    expect(screen.getByText(/Cargando insights/i)).toBeInTheDocument();
  });

  it("TanStack Query resuelve y renderiza el JSON crudo del Insight Engine", async () => {
    const { container } = renderWithProviders();
    // Esperamos a que la query resuelva. Como el <pre> contiene JSON
    // con muchas comillas y llaves, buscamos por selector directo en
    // lugar de matcher de texto (mas robusto que TL para JSON).
    await waitFor(() => {
      const pre = container.querySelector("pre");
      expect(pre).not.toBeNull();
      expect(pre!.textContent ?? "").not.toMatch(/Cargando/);
    });
    const pre = container.querySelector("pre")!;
    const parsed = JSON.parse(pre.textContent ?? "[]");
    expect(parsed).toEqual(SAMPLE_INSIGHTS);
  });

  it("fetch se llama contra /api/insight/insights con el rango temporal correcto", async () => {
    const { container } = renderWithProviders();
    await waitFor(() => {
      const pre = container.querySelector("pre");
      expect(pre?.textContent ?? "").not.toMatch(/Cargando/);
    });
    const calls = (fetch as unknown as { mock: { calls: [unknown][] } }).mock
      .calls;
    expect(calls.length).toBeGreaterThan(0);
    const url = String(calls[0]![0]);
    expect(url).toContain("/api/insight/insights");
    expect(url).toContain("from=2026-07-26T23%3A25%3A52Z");
    expect(url).toContain("to=");
  });

  it("propaga el error HTTP a la UI cuando la API falla", async () => {
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
      expect(screen.getByText(/Error/)).toBeInTheDocument();
    });
  });
});
