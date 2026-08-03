import { createElement, forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
import styles from "./Heading.module.css";

/**
 * Nivel semantico (1-6). Es INDEPENDIENTE del tamano visual: un `h2`
 * puede pintarse pequeno si el jerarquia visual lo pide (`visualSize`).
 * Separar semantica de estetica evita romper el arbol de headings solo
 * para conseguir un look.
 */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type HeadingVisualSize = "sm" | "md" | "lg" | "xl";

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  level?: HeadingLevel;
  visualSize?: HeadingVisualSize;
}

const visualSizeClass: Record<HeadingVisualSize, string | undefined> = {
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
  xl: styles.xl,
};

export const Heading = forwardRef<HTMLHeadingElement, HeadingProps>(
  function Heading(
    { level = 2, visualSize = "lg", className, children, ...rest },
    ref,
  ) {
    return createElement(
      `h${String(level)}`,
      {
        ref,
        className: cn(styles.root, visualSizeClass[visualSize], className),
        "data-level": level,
        "data-visual-size": visualSize,
        ...rest,
      },
      children,
    );
  },
);
