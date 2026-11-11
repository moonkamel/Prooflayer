import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Libellé englobant son champ : le nom accessible du champ est celui du libellé. */
export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-sm font-medium", className)} {...props} />
  );
}
