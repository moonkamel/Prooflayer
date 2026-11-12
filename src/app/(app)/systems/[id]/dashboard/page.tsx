// Fiche système, onglet « Tableau de bord » (PL-406, §5.3 écran C) : couverture de preuve, contrôles en échec,
// périmés, partiels et sans preuve, courbe sur 90 jours, tableau filtrable groupé par article.
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { CoverageTrend } from "@/components/dashboard/coverage-trend";
import { SummaryBand } from "@/components/dashboard/summary-band";
import { Alert } from "@/components/ui/alert";
import { WRITE_ROLES } from "@/server/services/role-policy";
import { loadSystem } from "../load";
import { ControlsExplorer } from "./controls-explorer";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { system } = await loadSystem((await params).id);
  return { title: `${(await getTranslations("dashboard"))("title")} · ${system.name}` };
}

export default async function SystemDashboardPage({ params }: Params) {
  const { api, system } = await loadSystem((await params).id);
  const [summary, org] = await Promise.all([
    api.dashboard.systemSummary({ systemId: system.id }),
    api.org.get(),
  ]);
  const t = await getTranslations("dashboard");
  const format = await getFormatter();
  const canWrite = WRITE_ROLES.includes(org.role) && !system.archivedAt;

  return (
    <section aria-labelledby="dashboard-title" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dashboard-title">{t("title")}</h2>
        <p className="text-xs text-muted-foreground" data-testid="last-evidence">
          {summary.lastEvidenceAt
            ? t("lastEvidence", { when: format.relativeTime(new Date(summary.lastEvidenceAt)) })
            : t("noEvidence")}
        </p>
      </div>
      {summary.integrations.failing.length > 0 && (
        <Alert tone="error">
          {t("integrationFailing")} <a href="/organization">{t("integrationLink")}</a>
        </Alert>
      )}
      <SummaryBand counts={summary.counts} />
      <CoverageTrend points={summary.timeline} />
      {summary.controls.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <ControlsExplorer systemId={system.id} controls={summary.controls} canWrite={canWrite} />
      )}
    </section>
  );
}
