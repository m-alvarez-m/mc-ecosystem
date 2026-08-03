import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlayerDrawer } from "../src/features/players";

// Tests focalizados del PlayerDrawer (D6). Verifican:
//   - se pinta solo cuando uuid !== null (cerrado por defecto)
//   - role=dialog + aria-modal=true + aria-labelledby
//   - focus inicial: botón Cerrar
//   - Escape cierra
//   - clic fuera (overlay) cierra
//   - Tab trap: cicla focusables del panel
//   - dispara fetch a /api/insight/player/:uuid al abrir
//   - loading / success / error se pintan con los componentes reutilizados

const UUID = "71804e99-f2aa-32dc-bfcb-0ea5cfdda708";

const FULL_PAYLOAD = {
  uuid: UUID,
  name: "Vancorbus",
  nameHistory: [
    { name: "OldName", seen_at: "2026-07-26T23:25:52Z" },
    { name: "Vancorbus", seen_at: "2026-08-01T09:00:00Z" },
  ],
  firstEvent: {
    id: "1",
    event_uuid: "00000000-0000-4000-8000-000000000001",
    type: "session.start",
    ts: "2026-07-26T23:26:00Z",
  },
  lastEvent: {
    id: "9999",
    event_uuid: "00000000-0000-4000-8000-000000009999",
    type: "block.break",
    ts: "2026-08-02T07:00:00Z",
  },
  totalEvents: "12500",
  eventsByType: [
    { type: "position.sample", count: "9000" },
    { type: "block.break", count: "1200" },
    { type: "session.start", count: "12" },
  ],
};

function stubOk(payload: unknown = FULL_PAYLOAD): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    }) as unknown as Response),
  );
}

function renderIt(uuid: string | null, onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <PlayerDrawer uuid={uuid} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

describe("PlayerDrawer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Ensure body scroll unlock even if a test crashed mid-way.
    document.body.style.overflow = "";
  });

  it("uuid=null: NO renderiza nada", () => {
    stubOk();
    const { container } = renderIt(null);
    expect(container.firstChild).toBeNull();
  });

  it("uuid !== null: pinta role=dialog + aria-modal + aria-labelledby", async () => {
    stubOk();
    renderIt(UUID);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    // El title empieza con placeholder "Detalle de jugador" y luego,
    // al resolver la query, pasa a mostrar el nombre real.
    await waitFor(() => {
      expect(document.getElementById(labelledBy!)?.textContent).toBe(
        "Vancorbus",
      );
    });
  });

  it("focus inicial: boton Cerrar recibe foco al abrir", async () => {
    stubOk();
    renderIt(UUID);
    const closeBtn = screen.getByRole("button", { name: /cerrar detalle/i });
    await waitFor(() => {
      expect(document.activeElement).toBe(closeBtn);
    });
  });

  it("Escape cierra el drawer (invoca onClose)", async () => {
    stubOk();
    const { onClose } = renderIt(UUID);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clic en el overlay cierra; clic en el panel NO cierra", async () => {
    stubOk();
    const { onClose } = renderIt(UUID);
    // Clic dentro del panel: NO cierra (stopPropagation).
    const panel = screen.getByTestId("player-drawer-panel");
    await userEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
    // Clic sobre el overlay: cierra.
    const overlay = screen.getByTestId("player-drawer-overlay");
    await userEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Tab trap: al llegar al ultimo focusable, Tab vuelve al primero", async () => {
    stubOk();
    renderIt(UUID);
    // Con un solo boton "Cerrar" en el panel, first === last. Tab
    // ciclara sobre si mismo.
    const closeBtn = screen.getByRole("button", { name: /cerrar detalle/i });
    await waitFor(() => {
      expect(document.activeElement).toBe(closeBtn);
    });
    await userEvent.tab();
    expect(document.activeElement).toBe(closeBtn);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(closeBtn);
  });

  it("dispara GET /api/insight/player/:uuid al abrir", async () => {
    stubOk();
    renderIt(UUID);
    await waitFor(() => {
      const calls = (fetch as unknown as { mock: { calls: [unknown][] } })
        .mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(String(calls[0]![0])).toContain(`/api/insight/player/${UUID}`);
    });
  });

  it("success: pinta totalEvents, primer/ultimo evento, historial y distribucion", async () => {
    stubOk();
    renderIt(UUID);
    // El titulo pinta "Vancorbus" al resolver — usamos el heading
    // como ancla para asegurar la resolucion sin colisionar con el
    // mismo texto dentro de <nameHistory>.
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { level: 2, name: "Vancorbus" }),
      ).toBeInTheDocument();
    });
    // Total (formatCount es-ES: 12.500)
    expect(screen.getByText("12.500")).toBeInTheDocument();
    // Primer/último evento — algunos tipos aparecen tambien en el
    // breakdown, asi que scopeamos a las regiones aria.
    const firstBlock = screen.getByLabelText("Primer evento");
    expect(within(firstBlock).getByText("session.start")).toBeInTheDocument();
    const lastBlock = screen.getByLabelText("Último evento");
    expect(within(lastBlock).getByText("block.break")).toBeInTheDocument();
    // Historial de nombres: ambos nombres presentes (dentro de la lista).
    const nameList = screen.getByRole("list", {
      name: /historial de nombres/i,
    });
    expect(within(nameList).getByText("OldName")).toBeInTheDocument();
    expect(within(nameList).getByText("Vancorbus")).toBeInTheDocument();
    // Distribución: 3 tipos visibles con conteo formateado.
    const dl = screen.getByLabelText(/distribución de eventos por tipo/i);
    expect(within(dl).getByText("position.sample")).toBeInTheDocument();
    expect(within(dl).getByText("9.000")).toBeInTheDocument();
    expect(within(dl).getByText("1.200")).toBeInTheDocument();
  });

  it("error: pinta ErrorState role=alert + boton Reintentar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => "boom",
      }) as unknown as Response),
    );
    renderIt(UUID);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/no se pudo cargar el jugador/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reintentar/i }),
    ).toBeInTheDocument();
  });

  it("body scroll queda bloqueado mientras el drawer esta abierto", () => {
    stubOk();
    renderIt(UUID);
    expect(document.body.style.overflow).toBe("hidden");
  });
});
