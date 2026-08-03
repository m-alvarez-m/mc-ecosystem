import type { HTMLAttributes } from "react";
import { cn } from "../utils";
import styles from "./Content.module.css";

// Contenedor vertical dentro de `<Page>` que separa bloques del layout
// con gap uniforme. No introduce semantica adicional — `<div>` puro
// para no compite con `<section>` que ya expone `<Section>`.

export interface ContentProps extends HTMLAttributes<HTMLDivElement> {}

export function Content({
  className,
  children,
  ...rest
}: ContentProps): JSX.Element {
  return (
    <div className={cn(styles.root, className)} {...rest}>
      {children}
    </div>
  );
}
