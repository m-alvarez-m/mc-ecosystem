import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../../utils";
import styles from "./Section.module.css";

export type SectionPadding = "none" | "sm" | "md" | "lg";

export interface SectionProps extends HTMLAttributes<HTMLElement> {
  padding?: SectionPadding;
}

const paddingClass: Record<SectionPadding, string | undefined> = {
  none: styles.paddingNone,
  sm: styles.paddingSm,
  md: styles.paddingMd,
  lg: styles.paddingLg,
};

export const Section = forwardRef<HTMLElement, SectionProps>(function Section(
  { padding = "md", className, children, ...rest },
  ref,
) {
  return (
    <section
      ref={ref}
      className={cn(styles.root, paddingClass[padding], className)}
      data-padding={padding}
      {...rest}
    >
      {children}
    </section>
  );
});
