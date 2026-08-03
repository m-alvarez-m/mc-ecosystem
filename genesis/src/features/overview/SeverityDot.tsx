import { cn } from "../../utils";
import type { Severity } from "../../api/insights";
import { severityView, type SeverityTone } from "./formatters";
import styles from "./SeverityDot.module.css";

export interface SeverityDotProps {
  severity: Severity;
}

const toneClass: Record<SeverityTone, string | undefined> = {
  success: styles.success,
  info: styles.info,
  warning: styles.warning,
  danger: styles.danger,
};

// Representacion visual mínima de severity: un dot coloreado + label.
// El color viene del theme (via var(--gs-color-*)); nada hardcodeado
// en el componente. Se usa `aria-label` sobre el dot para que screen
// readers no anuncien el color pero sí la etiqueta como texto.

export function SeverityDot({ severity }: SeverityDotProps): JSX.Element {
  const view = severityView(severity);
  return (
    <span className={styles.root} data-severity={severity}>
      <span
        className={cn(styles.dot, toneClass[view.tone])}
        aria-hidden="true"
      />
      {view.label}
    </span>
  );
}
