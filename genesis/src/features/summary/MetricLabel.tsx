import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
import styles from "./MetricLabel.module.css";

// Etiqueta pequeña de un KPI (ej. "Total events"). Uppercase +
// letter-spacing para separarla visualmente del value grande.
// Semanticamente es un <span> — la relación label→value va por
// aria-labelledby en KpiCard.

export type MetricLabelProps = HTMLAttributes<HTMLSpanElement>;

export function MetricLabel({
  className,
  children,
  ...rest
}: MetricLabelProps): JSX.Element {
  return (
    <span className={cn(styles.root, className)} {...rest}>
      {children}
    </span>
  );
}
