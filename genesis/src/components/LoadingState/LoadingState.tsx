import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
import styles from "./LoadingState.module.css";

export interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  /** Etiqueta visible para screen readers y usuarios; default "Cargando…". */
  label?: string;
}

// Loading state reutilizable. Sin spinners gigantes: un dot pulsante
// + label discreta. `role="status"` + `aria-live="polite"` para que
// screen readers anuncien el cambio sin interrumpir la lectura.

export function LoadingState({
  label = "Cargando…",
  className,
  ...rest
}: LoadingStateProps): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(styles.root, className)}
      {...rest}
    >
      <span className={styles.dot} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
