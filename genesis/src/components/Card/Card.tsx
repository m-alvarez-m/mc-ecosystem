import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
import styles from "./Card.module.css";

export type CardVariant = "surface" | "elevated";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

const variantClass: Record<CardVariant, string | undefined> = {
  surface: styles.surface,
  elevated: styles.elevated,
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "surface", className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(styles.root, variantClass[variant], className)}
      data-variant={variant}
      {...rest}
    >
      {children}
    </div>
  );
});
