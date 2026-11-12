// Courbe de couverture sur 90 jours (§5.3 écran C) : SVG décoratif doublé d'un résumé textuel et d'une table de
// données dépliable (WCAG 1.1.1) ; la valeur de chaque jour est accessible sans la courbe.
import { useTranslations } from "next-intl";
import type { TimelinePoint } from "@/server/services/dashboard-data";

const W = 360;
const H = 56;

export function CoverageTrend({ points }: { points: TimelinePoint[] }) {
  const t = useTranslations("dashboard");
  const max = Math.max(1, ...points.map((p) => p.applicable));
  const x = (i: number) => (points.length <= 1 ? 0 : (i / (points.length - 1)) * W);
  const y = (v: number) => H - 2 - (v / max) * (H - 4);
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.pass).toFixed(1)}`)
    .join(" ");
  const scope = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.applicable).toFixed(1)}`)
    .join(" ");
  const first = points[0];
  const last = points.at(-1);
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs font-medium text-muted-foreground">
        {t("trendTitle")}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-14 w-full max-w-md"
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        <path
          d={scope}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
        {line && <path d={`${line} L${W},${H} L0,${H} Z`} fill="var(--color-accent)" />}
        <path
          d={line}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      {first && last && (
        <p className="text-xs text-muted-foreground" data-testid="trend-summary">
          {t("trendSummary", { from: first.pass, to: last.pass })}
        </p>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-link underline underline-offset-2">
          {t("trendData")}
        </summary>
        <table className="mt-2 border-collapse tabular-nums">
          <thead>
            <tr>
              <th scope="col" className="pr-4 text-left font-medium">
                {t("day")}
              </th>
              <th scope="col" className="text-left font-medium">
                {t("coverage")}
              </th>
            </tr>
          </thead>
          <tbody>
            {points
              .filter((_, i) => (points.length - 1 - i) % 7 === 0)
              .map((p) => (
                <tr key={p.day}>
                  <td className="pr-4">{p.day}</td>
                  <td>{t("coverageValue", { pass: p.pass, applicable: p.applicable })}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
