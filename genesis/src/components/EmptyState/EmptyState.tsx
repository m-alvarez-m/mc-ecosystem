import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../utils";
import { PlaceholderIcon } from "../../icons";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  body?: string;
  /** Slot para acciones (e.g. un Button). Se pinta debajo del body. */
  actions?: ReactNode;
}

// Empty state reutilizable. Sin ilustraciones fancy — un icono
// placeholder + titulo + body + slot de acciones. Suficiente para
// D3; puede reemplazarse por una ilustracion real cuando el proyecto
// tenga identidad grafica.

export function EmptyState({
  title,
  body,
  actions,
  className,
  ...rest
}: EmptyStateProps): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(styles.root, className)}
      {...rest}
    >
      <div className={styles.icon}>
        <PlaceholderIcon size={40} />
      </div>
      <h2 className={styles.title}>{title}</h2>
      {body !== undefined ? <p className={styles.body}>{body}</p> : null}
      {actions !== undefined ? <div>{actions}</div> : null}
    </div>
  );
}
