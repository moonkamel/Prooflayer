import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Message d'erreur (role="alert") ou d'information (role="status"), jamais porté par la couleur seule. */
export function Alert({
  className,
  tone = "info",
  ...props
}: ComponentProps<"p"> & { tone?: "info" | "error" }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        tone === "error"
          ? "border-red-300 bg-red-50 text-red-900"
          : "border-sky-300 bg-sky-50 text-sky-950",
        className,
      )}
      {...props}
    />
  );
}
