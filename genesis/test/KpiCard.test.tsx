import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { KpiCard } from "../src/features/summary";

describe("KpiCard", () => {
  it("renderiza label y value visibles", () => {
    render(<KpiCard label="Total events" value="14.115" />);
    expect(screen.getByText("Total events")).toBeInTheDocument();
    expect(screen.getByText("14.115")).toBeInTheDocument();
  });

  it("expone role=group con aria-labelledby apuntando al label", () => {
    render(<KpiCard label="Total events" value="14.115" />);
    const group = screen.getByRole("group");
    const labelledBy = group.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const label = document.getElementById(labelledBy!);
    expect(label?.textContent).toBe("Total events");
  });

  it("hint opcional se pinta cuando se provee, no se pinta cuando no", () => {
    const { rerender } = render(
      <KpiCard label="Last event" value="2 ago 2026" hint="server.tps_sample" />,
    );
    expect(screen.getByText("server.tps_sample")).toBeInTheDocument();
    rerender(<KpiCard label="Last event" value="2 ago 2026" />);
    expect(screen.queryByText("server.tps_sample")).toBeNull();
  });

  it("valueSize 'compact' viaja como data-value-size (para fechas largas)", () => {
    const { container } = render(
      <KpiCard label="First event" value="2 ago 2026" valueSize="compact" />,
    );
    const el = container.querySelector('[data-value-size="compact"]');
    expect(el).not.toBeNull();
  });

  it("value acepta ReactNode arbitrario (no solo string)", () => {
    render(<KpiCard label="Streak" value={<em>42 días</em>} />);
    expect(screen.getByText("42 días").tagName).toBe("EM");
  });
});
