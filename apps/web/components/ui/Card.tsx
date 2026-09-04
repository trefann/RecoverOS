import clsx from "clsx";
import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("rounded-3xl border border-surface-border bg-surface-panel", className)}
      {...props}
    />
  );
}
