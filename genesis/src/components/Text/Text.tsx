import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
import styles from "./Text.module.css";

export type TextSize = "xs" | "sm" | "md" | "lg" | "xl";
export type TextWeight = "regular" | "medium" | "semibold" | "bold";
export type TextAs = "p" | "span";

export interface TextProps extends HTMLAttributes<HTMLElement> {
  as?: TextAs;
  size?: TextSize;
  weight?: TextWeight;
  muted?: boolean;
}

const sizeClass: Record<TextSize, string | undefined> = {
  xs: styles.xs,
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
  xl: styles.xl,
};

const weightClass: Record<TextWeight, string | undefined> = {
  regular: styles.regular,
  medium: styles.medium,
  semibold: styles.semibold,
  bold: styles.bold,
};

// Polimorfico simple: `<p>` (default, bloque) o `<span>` (inline).
// No usamos generics porque las dos etiquetas comparten los mismos
// atributos HTML relevantes para D2.
export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  {
    as = "p",
    size = "md",
    weight = "regular",
    muted = false,
    className,
    children,
    ...rest
  },
  ref,
) {
  const composed = cn(
    styles.root,
    sizeClass[size],
    weightClass[weight],
    muted && styles.muted,
    className,
  );
  if (as === "span") {
    return (
      <span
        ref={ref as React.Ref<HTMLSpanElement>}
        className={composed}
        {...rest}
      >
        {children}
      </span>
    );
  }
  return (
    <p ref={ref as React.Ref<HTMLParagraphElement>} className={composed} {...rest}>
      {children}
    </p>
  );
});
