import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActivityAnalytics } from "../src/features/activity";

// Tests focalizados de ActivityAnalytics (D7). Sin router.
//
// Escenarios:
//   - loading -> LoadingState
//   - success con datos -> 2 Cards + heatmap + chart
//   - empty (ambos vacios) -> EmptyState + NO cards
//   - error en alguna query -> ErrorState + Reintentar

function renderIt() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ActivityAnalytics />
    </QueryClientProvider>,
  );
}

const HOURLY = [
  { hour: 0, count: "10" },
  { hour: 12, count: "120" },
];
const DAILY = [
  { date: "2026-07-27", count: "500" },
  { date: "2026-07-28", count: "300" },
];

interface Stubs {
  hourly?: unknown | { fail: true };
  daily?: unknown | { fail: true };
}

function stub(map: Stubs): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      const target = url.includes("/api/insight/activity/hourly")
        ? map.hourly
        : url.includes("/api/insight/activity/daily")
          ? map.daily
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

describe("ActivityAnalytics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("loading", () => {
    beforeEach(() => {
      stub({ hourly: HOURLY, daily: DAILY });
    });

    it("pinta LoadingState 'Cargando actividad…' + heading h2", () => {
      renderIt();
      expect(screen.getByText(/cargando actividad/i)).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 2, name: /^activity analytics$/i }),
      ).toBeInTheDocument();
    });
  });

  describe("success", () => {
    beforeEach(() => {
      stub({ hourly: HOURLY, daily: DAILY });
    });

    it("pinta 2 Cards con heatmap + chart y sus titulos internos", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByTestId("activity-cards")).toBeInTheDocument();
      });
      expect(screen.getByTestId("hourly-heatmap")).toBeInTheDocument();
      expect(screen.getByTestId("daily-chart")).toBeInTheDocument();
      expect(screen.getByText(/actividad por hora \(utc\)/i)).toBeInTheDocument();
      expect(screen.getByText(/^actividad diaria$/i)).toBeInTheDocument();
    });

    it("heatmap tiene 24 celdas (relleno de horas vacías)", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByTestId("hourly-heatmap")).toBeInTheDocument();
      });
      const heatmap = screen.getByTestId("hourly-heatmap");
      expect(heatmap.querySelectorAll('[role="img"]').length).toBe(24);
    });
  });

  describe("empty", () => {
    beforeEach(() => {
      stub({ hourly: [], daily: [] });
    });

    it("[] en ambos -> EmptyState + NO cards", async () => {
      renderIt();
      await waitFor(() => {
        expect(
          screen.getByText(/sin actividad para graficar/i),
        ).toBeInTheDocument();
      });
      expect(screen.queryByTestId("activity-cards")).toBeNull();
    });
  });

  describe("error", () => {
    it("fallo del hourly -> ErrorState + boton Reintentar", async () => {
      stub({ hourly: { fail: true }, daily: DAILY });
      renderIt();
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
      expect(
        screen.getByText(/no se pudo cargar la actividad/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /reintentar/i }),
      ).toBeInTheDocument();
    });

    it("fallo del daily tambien lo dispara", async () => {
      stub({ hourly: HOURLY, daily: { fail: true } });
      renderIt();
      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeInTheDocument();
      });
    });
  });

  describe("request contract", () => {
    beforeEach(() => {
      stub({ hourly: HOURLY, daily: DAILY });
    });

    it("hourly usa from=ADR-007; daily usa ventana de ~30 días", async () => {
      renderIt();
      await waitFor(() => {
        expect(screen.getByTestId("activity-cards")).toBeInTheDocument();
      });
      const calls = (fetch as unknown as { mock: { calls: [unknown][] } })
        .mock.calls;
      const urls = calls.map((c) => String(c[0]));
      const hourlyUrl = urls.find((u) =>
        u.includes("/api/insight/activity/hourly"),
      );
      const dailyUrl = urls.find((u) =>
        u.includes("/api/insight/activity/daily"),
      );
      expect(hourlyUrl).toBeDefined();
      expect(hourlyUrl!).toContain("from=2026-07-26T23%3A25%3A52Z");
      expect(dailyUrl).toBeDefined();
      // El dailyFrom debe ser reciente (contiene el año actual del render).
      expect(dailyUrl!).toMatch(/from=\d{4}-\d{2}-\d{2}T/);
      expect(dailyUrl!).toMatch(/to=\d{4}-\d{2}-\d{2}T/);
    });
  });
});
