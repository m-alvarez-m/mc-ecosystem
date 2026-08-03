import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
import styles from "./Divider.module.css";

export type DividerOrientation = "horizontal" | "vertical";

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: DividerOrientation;
}

// Divider como <div role="separator"> — semantica correcta y permite
// controlar orientacion via aria-orientation para lectores de pantalla.
export function Divider({
  orientation = "horizontal",
  className,
  ...rest
}: DividerProps): JSX.Element {
  const orientationClass =
    orientation === "vertical" ? styles.vertical : styles.horizontal;
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(orientationClass, className)}
      {...rest}
    />
  );
}
