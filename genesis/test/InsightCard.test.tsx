import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { InsightCard } from "../src/features/overview";
import type { Insight } from "../src/api/insights";

// Contrato de InsightCard: recibe un `Insight` y lo presenta con
// titulo humano, categoria, severity/confidence, ventana, facts y
// evidence. NO se testean ESTILOS visuales.

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: "activity-trend",
    category: "activity",
    severity: "normal",
    confidence: "high",
    generatedAt: "2026-08-02T00:00:00Z",
    window: { from: "2026-07-26T23:25:52Z", to: "2026-08-02T00:00:00Z" },
    facts: { currentEvents: "42", ratio: 1.05, trend: "flat" },
    evidence: ["activitySignal"],
    metadata: {
      engineVersion: "1.0",
      severityThresholds: { normal: 0.1, low: 0.25, high: 0.5 },
      confidenceThresholds: { medium: 10, high: 100 },
    },
    ...overrides,
  };
}

describe("InsightCard", () => {
  it("pinta el titulo humano de cada insight conocido", () => {
    render(<InsightCard insight={makeInsight({ id: "activity-trend" })} />);
    expect(screen.getByText("Tendencia de actividad")).toBeInTheDocument();
    render(<InsightCard insight={makeInsight({ id: "exploration-trend" })} />);
    expect(screen.getByText("Tendencia de exploración")).toBeInTheDocument();
    render(<InsightCard insight={makeInsight({ id: "economy-focus" })} />);
    expect(screen.getByText("Foco económico")).toBeInTheDocument();
    render(<InsightCard insight={makeInsight({ id: "player-engagement" })} />);
    expect(screen.getByText("Compromiso de jugadores")).toBeInTheDocument();
  });

  it("pinta la categoria en español y el rango de ventana", () => {
    const { container } = render(
      <InsightCard insight={makeInsight({ category: "activity" })} />,
    );
    expect(container.textContent ?? "").toMatch(/Actividad/);
    expect(container.textContent ?? "").toMatch(/Ventana:/);
  });

  it("expone data-severity con el valor del insight", () => {
    const { container } = render(
      <InsightCard insight={makeInsight({ severity: "critical" })} />,
    );
    expect(
      container.querySelector('[data-severity="critical"]'),
    ).not.toBeNull();
  });

  it("severity crítico se etiqueta como 'Crítico'", () => {
    render(<InsightCard insight={makeInsight({ severity: "critical" })} />);
    expect(screen.getByText("Crítico")).toBeInTheDocument();
  });

  it("confidence se pinta como Badge (no como porcentaje)", () => {
    render(<InsightCard insight={makeInsight({ confidence: "medium" })} />);
    expect(screen.getByText("Confianza media")).toBeInTheDocument();
    // No debe existir ningun "%" en la card.
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("facts se renderizan como definition list (dt/dd) humanizados", () => {
    const { container } = render(
      <InsightCard
        insight={makeInsight({
          facts: { currentEvents: "42", totalEventsRatio: 0.5 },
        })}
      />,
    );
    const dl = container.querySelector("dl")!;
    expect(dl).toBeInTheDocument();
    expect(within(dl).getByText("Current events")).toBeInTheDocument();
    expect(within(dl).getByText("42")).toBeInTheDocument();
    expect(within(dl).getByText("Total events ratio")).toBeInTheDocument();
    // 0.5 se formatea como "0.5" tras trimming de ceros.
    expect(within(dl).getByText("0.5")).toBeInTheDocument();
  });

  it("evidence se pinta como grupo aria de badges", () => {
    render(
      <InsightCard
        insight={makeInsight({ evidence: ["activitySignal", "explorationSignal"] })}
      />,
    );
    const group = screen.getByRole("group", { name: /signals/i });
    expect(group).toBeInTheDocument();
    expect(within(group).getByText("activitySignal")).toBeInTheDocument();
    expect(within(group).getByText("explorationSignal")).toBeInTheDocument();
  });

  it("evidence vacio: no pinta la seccion 'Basado en'", () => {
    render(<InsightCard insight={makeInsight({ evidence: [] })} />);
    expect(screen.queryByText(/basado en/i)).toBeNull();
  });

  it("no expone la metadata tecnica en el DOM visible", () => {
    const { container } = render(<InsightCard insight={makeInsight()} />);
    // engineVersion / severityThresholds no deben pintarse.
    expect(container.textContent ?? "").not.toMatch(/engineVersion/);
    expect(container.textContent ?? "").not.toMatch(/severityThresholds/);
    expect(container.textContent ?? "").not.toMatch(/confidenceThresholds/);
  });

  it("cada card es un <article> con aria-labelledby apuntando al titulo", () => {
    const { container } = render(
      <InsightCard insight={makeInsight({ id: "activity-trend" })} />,
    );
    const article = container.querySelector("article")!;
    const labelledBy = article.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const title = container.querySelector(`#${labelledBy!}`);
    expect(title?.textContent).toBe("Tendencia de actividad");
  });
});
