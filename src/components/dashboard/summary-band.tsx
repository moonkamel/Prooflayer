// Bandeau de synthèse (§5.3 écran C) : couverture de preuve et, toujours à côté, les contrôles en échec, périmés,
// partiels et sans preuve. Chaque compteur porte une icône et un libellé : jamais la couleur seule (§5.2).
import { useTranslations } from "next-intl";
import { STATUS_STYLES } from "@/components/status-badge";
import type { StatusCount } from "@/server/services/dashboard-data";
import { CoverageMeter } from "./coverage-meter";

const COUNTERS = [
  { key: "failing", status: "FAIL", field: "fail" },
  { key: "stale", status: "STALE", field: "stale" },
  { key: "partial", status: "PARTIAL", field: "partial" },
  { key: "missing", status: "MISSING", field: "missing" },
] as const;

export function SummaryBand({ counts }: { counts: StatusCount }) {
  const t = useTranslations("dashboard");
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-5">
      <div className="col-span-2 bg-background px-4 py-3 sm:col-span-1">
        <dt className="text-xs font-medium text-muted-foreground">{t("coverage")}</dt>
        <dd className="mt-1" data-testid="coverage">
          <CoverageMeter pass={counts.pass} applicable={counts.applicable} />
        </dd>
      </div>
      {COUNTERS.map(({ key, status, field }) => {
        const { icon: Icon, fg } = STATUS_STYLES[status];
        return (
          <div key={key} className="bg-background px-4 py-3">
            <dt className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Icon aria-hidden="true" className="size-3.5" style={{ color: fg }} />
              {t(key)}
            </dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums" data-testid={`count-${key}`}>
              {counts[field]}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
