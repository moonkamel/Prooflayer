// Jauge de couverture de preuve (PL-406) : la valeur est toujours écrite ; la barre n'est qu'un rappel visuel.
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export function CoverageMeter({
  pass,
  applicable,
  size = "md",
}: {
  pass: number;
  applicable: number;
  size?: "sm" | "md";
}) {
  const t = useTranslations("dashboard");
  const ratio = applicable === 0 ? 0 : pass / applicable;
  return (
    <span
      className="inline-flex min-w-0 items-center gap-2"
      title={t("coverageLabel", { pass, applicable })}
    >
      <span className={cn("font-semibold tabular-nums", size === "md" ? "text-lg" : "text-sm")}>
        {t("coverageValue", { pass, applicable })}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative block overflow-hidden rounded-full bg-accent",
          size === "md" ? "h-2 w-32" : "h-1.5 w-20",
        )}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </span>
      <span className="sr-only">{t("coverageLabel", { pass, applicable })}</span>
    </span>
  );
}
