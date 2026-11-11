import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Tableau dense (§5.2 : tableaux triables et filtrables, pas de cartes décoratives). */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "border-b border-border px-2 py-1.5 text-left text-xs font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td className={cn("border-b border-border px-2 py-1.5 align-middle", className)} {...props} />
  );
}
