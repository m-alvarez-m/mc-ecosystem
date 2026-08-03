import { useId, type ReactNode } from "react";
import { Card } from "../../components";
import { MetricLabel } from "./MetricLabel";
import { MetricValue } from "./MetricValue";
import styles from "./KpiCard.module.css";

export interface KpiCardProps {
  label: string;
  /** Valor principal (string ya formateado por el llamador o ReactNode). */
  value: ReactNode;
  /** Anotación opcional debajo del valor (ej. tipo del evento). */
  hint?: string;
  /** Tamaño del valor: "default" (números) o "compact" (fechas largas). */
  valueSize?: "default" | "compact";
}

// KPI atomico. Compuesto: Card (D2) + MetricLabel + MetricValue.
// Sin lógica de negocio: recibe strings ya formateadas. La relación
// label↔value se declara con aria-labelledby para que un screen
// reader anuncie "<label>: <value>".

export function KpiCard({
  label,
  value,
  hint,
  valueSize = "default",
}: KpiCardProps): JSX.Element {
  const labelId = useId();
  return (
    <Card variant="surface" data-kpi>
      <div
        className={styles.root}
        role="group"
        aria-labelledby={labelId}
        data-value-size={valueSize}
      >
        <MetricLabel id={labelId}>{label}</MetricLabel>
        <MetricValue size={valueSize}>{value}</MetricValue>
        {hint !== undefined ? <span className={styles.hint}>{hint}</span> : null}
      </div>
    </Card>
  );
}
