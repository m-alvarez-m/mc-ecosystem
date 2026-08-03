import type { HTMLAttributes } from "react";
import { cn } from "../utils";
import styles from "./Page.module.css";

// Landmark principal del arbol. Renderiza `<main>` para que lectores
// de pantalla lo expongan como region principal. Cada ruta monta un
// unico `<Page>`; no anidar.

export interface PageProps extends HTMLAttributes<HTMLElement> {}

export function Page({ className, children, ...rest }: PageProps): JSX.Element {
  return (
    <main className={cn(styles.root, className)} {...rest}>
      {children}
    </main>
  );
}
