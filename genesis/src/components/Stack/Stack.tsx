import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
import type { SpacingKey } from "../../theme";
import styles from "./Stack.module.css";

export type StackDirection = "row" | "column";
export type StackAlign = "start" | "center" | "end" | "stretch";
export type StackJustify = "start" | "center" | "end" | "between";

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  direction?: StackDirection;
  gap?: SpacingKey;
  align?: StackAlign;
  justify?: StackJustify;
  wrap?: boolean;
}

const gapClass: Record<SpacingKey, string | undefined> = {
  0: styles.gap0,
  1: styles.gap1,
  2: styles.gap2,
  3: styles.gap3,
  4: styles.gap4,
  5: styles.gap5,
  6: styles.gap6,
  8: styles.gap8,
  10: styles.gap10,
  12: styles.gap12,
  16: styles.gap16,
};

const alignClass: Record<StackAlign, string | undefined> = {
  start: styles.alignStart,
  center: styles.alignCenter,
  end: styles.alignEnd,
  stretch: styles.alignStretch,
};

const justifyClass: Record<StackJustify, string | undefined> = {
  start: styles.justifyStart,
  center: styles.justifyCenter,
  end: styles.justifyEnd,
  between: styles.justifyBetween,
};

export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  {
    direction = "column",
    gap = 4,
    align = "stretch",
    justify = "start",
    wrap = false,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        styles.root,
        direction === "row" ? styles.row : styles.column,
        gapClass[gap],
        alignClass[align],
        justifyClass[justify],
        wrap && styles.wrap,
        className,
      )}
      data-direction={direction}
      {...rest}
    >
      {children}
    </div>
  );
});
