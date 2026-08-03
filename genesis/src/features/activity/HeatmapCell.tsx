import type { CSSProperties } from "react";
import styles from "./HeatmapCell.module.css";

export interface HeatmapCellProps {
  /** 0..23, hora UTC. */
  hour: number;
  /** Conteo entero (STRING BIGINT-safe pasado como string). */
  count: string;
  /** Intensidad normalizada 0..1 (se calcula en el padre). */
  intensity: number;
}

// Celda de una hora del HourlyHeatmap. Sin librerías: color base
// del theme (`--gs-color-primary`) con `opacity` en escala 0.08..1
// según intensidad. La escala arranca en 0.08 para que las celdas
// vacías sean visibles como marca (no invisibles) y transmita
// "estructura del día" incluso sin datos.
//
// Accesibilidad: role=img + aria-label textual con la información
// completa; title (native tooltip) como complemento — nunca única
// fuente de la info.

const HOUR_LABEL = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function HeatmapCell({
  hour,
  count,
  intensity,
}: HeatmapCellProps): JSX.Element {
  const clamped = Math.max(0, Math.min(1, intensity));
  const opacity = 0.08 + clamped * 0.92;
  const label = `Hora ${HOUR_LABEL(hour)} UTC · ${count} eventos`;
  const style: CSSProperties = { opacity };
  return (
    <div
      className={styles.root}
      role="img"
      aria-label={label}
      title={label}
      style={style}
      data-hour={hour}
      data-count={count}
    />
  );
}
