import type { CSSProperties } from "react";
import { cn } from "../../utils";
import styles from "./ChartBar.module.css";

export interface ChartBarProps {
  /** ISO YYYY-MM-DD para el dataset y para el label formateado. */
  date: string;
  /** Conteo entero (STRING BIGINT-safe). */
  count: string;
  /** Etiqueta corta a mostrar bajo la barra (ej. "26 jul"). */
  label: string;
  /** Etiqueta accesible completa (ej. "2026-07-26 · 128 eventos"). */
  ariaLabel: string;
  /** Altura normalizada 0..1. */
  intensity: number;
}

// Barra vertical de un día del DailyChart. Sin librerías: div con
// height calc(pct * 100%). CSS custom prop `--pct` inyectada
// inline. Barra vacía (count=0) queda como marca gris (border
// color) para no desaparecer del gráfico.

export function ChartBar({
  date,
  count,
  label,
  ariaLabel,
  intensity,
}: ChartBarProps): JSX.Element {
  const clamped = Math.max(0, Math.min(1, intensity));
  const style: CSSProperties = {
    ["--pct" as string]: clamped.toFixed(4),
  };
  const isEmpty = count === "0" || count === "" || count === "—";
  return (
    <div className={styles.root} data-date={date} data-count={count}>
      <div className={styles.track}>
        <div
          className={cn(styles.bar, isEmpty && styles.barEmpty)}
          role="img"
          aria-label={ariaLabel}
          title={ariaLabel}
          style={style}
        />
      </div>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
