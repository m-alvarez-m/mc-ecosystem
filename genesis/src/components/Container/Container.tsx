import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
import styles from "./Container.module.css";

export type ContainerSize = "narrow" | "default" | "wide" | "full";

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  size?: ContainerSize;
}

const sizeClass: Record<ContainerSize, string | undefined> = {
  narrow: styles.narrow,
  default: styles.default,
  wide: styles.wide,
  full: styles.full,
};

export const Container = forwardRef<HTMLDivElement, ContainerProps>(
  function Container({ size = "default", className, children, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={cn(styles.root, sizeClass[size], className)}
        data-size={size}
        {...rest}
      >
        {children}
      </div>
    );
  },
);
