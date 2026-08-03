import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
import styles from "./Badge.module.css";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "info";
export type BadgeSize = "sm" | "md";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
}

const variantClass: Record<BadgeVariant, string | undefined> = {
  neutral: styles.neutral,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
  info: styles.info,
};

const sizeClass: Record<BadgeSize, string | undefined> = {
  sm: styles.sm,
  md: styles.md,
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = "neutral", size = "sm", className, children, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(styles.root, variantClass[variant], sizeClass[size], className)}
      data-variant={variant}
      data-size={size}
      {...rest}
    >
      {children}
    </span>
  );
});
