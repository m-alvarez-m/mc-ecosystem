import type { HTMLAttributes } from "react";
import { cn } from "../utils";
import styles from "./AppLayout.module.css";

// Esqueleto raiz del app. D2 no incluye sidebar / header / navegacion:
// solo el contenedor vertical que aloja `<Page>` (y en el futuro,
// header/sidebar cuando D4+ los introduzca). El fondo global y el
// color de texto viven aqui para que el resto del arbol no repita
// esas reglas.

export interface AppLayoutProps extends HTMLAttributes<HTMLDivElement> {}

export function AppLayout({
  className,
  children,
  ...rest
}: AppLayoutProps): JSX.Element {
  return (
    <div className={cn(styles.root, className)} {...rest}>
      {children}
    </div>
  );
}
