import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
import styles from "./MetricValue.module.css";

// Valor grande de un KPI. Numérico tabular (evita saltos entre
// dígitos). `size="compact"` para valores textuales largos (ej.
// fechas) que necesitan menos peso visual.

export interface MetricValueProps extends HTMLAttributes<HTMLSpanElement> {
  size?: "default" | "compact";
}

export function MetricValue({
  size = "default",
  className,
  children,
  ...rest
}: MetricValueProps): JSX.Element {
  return (
    <span
      className={cn(styles.root, size === "compact" && styles.compact, className)}
      data-size={size}
      {...rest}
    >
      {children}
    </span>
  );
}
