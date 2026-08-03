import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
import { Button } from "../Button";
import styles from "./ErrorState.module.css";

export interface ErrorStateProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  /**
   * Descripcion visible del error. Se muestra tal cual — el llamador
   * decide si expone el message crudo o algo mas amable.
   */
  message?: string;
  /**
   * Handler opcional del boton "Reintentar". Si no se provee, no se
   * pinta el boton (algunos errores no son recuperables).
   */
  onRetry?: () => void;
}

// ErrorState reutilizable. `role="alert"` para que screen readers
// interrumpan y anuncien inmediatamente. Colores rojo suave (bg +
// borde + texto oscuro) — el theme reserva el rojo intenso al Button
// danger; aqui buscamos "alerta legible", no "peligro extremo".

export function ErrorState({
  title = "Error al cargar",
  message,
  onRetry,
  className,
  ...rest
}: ErrorStateProps): JSX.Element {
  return (
    <div role="alert" className={cn(styles.root, className)} {...rest}>
      <h2 className={styles.title}>{title}</h2>
      {message !== undefined ? <p className={styles.body}>{message}</p> : null}
      {onRetry !== undefined ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}
