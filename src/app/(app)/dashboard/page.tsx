// Dashboard de l'organisation (PL-406, vue organisation) : couverture de preuve de chaque système surveillé, avec ses
// contrôles en échec, périmés et sans preuve. Jamais de « score de conformité » (§5.2).
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { CoverageMeter } from "@/components/dashboard/coverage-meter";
import { SummaryBand } from "@/components/dashboard/summary-band";
import { Alert } from "@/components/ui/alert";
import { serverCaller } from "@/server/caller";
import { requireSession } from "@/server/services/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("dashboard"))("title") };
}

export default async function OrgDashboardPage() {
  await requireSession();
  const api = await serverCaller();
  const summary = await api.dashboard.orgSummary();
  const t = await getTranslations("dashboard");
  const tk = await getTranslations("riskTier");
  const format = await getFormatter();

  return (
    <section aria-labelledby="org-dashboard-title" className="space-y-4">
      <h1 id="org-dashboard-title">{t("title")}</h1>
      <p className="max-w-3xl text-muted-foreground">{t("orgIntro")}</p>
      {summary.failingIntegrations.length > 0 && (
        <Alert tone="error">
          {t("integrationFailing")} <a href="/organization">{t("integrationLink")}</a>
        </Alert>
      )}
      <SummaryBand counts={summary.total} />
      <h2>{t("systems")}</h2>
      {summary.systems.length === 0 ? (
        <Alert>
          {t("noSystems")} <Link href="/systems">{t("openRegistry")}</Link>
        </Alert>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-sm" data-testid="org-systems">
            <thead className="bg-surface text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("system")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("tier")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("coverage")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("failing")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("stale")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("missing")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("lastEvaluation")}
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.systems.map((s) => (
                <tr
                  key={s.id}
                  data-testid="org-system"
                  className="border-t border-border hover:bg-surface"
                >
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    <Link href={`/systems/${s.id}/dashboard`}>{s.name}</Link>
                  </th>
                  <td className="px-3 py-2">{tk(s.riskTier)}</td>
                  <td className="px-3 py-2">
                    <CoverageMeter
                      pass={s.counts.pass}
                      applicable={s.counts.applicable}
                      size="sm"
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.counts.fail}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.counts.stale}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.counts.missing}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {s.lastEvaluatedAt
                      ? format.relativeTime(new Date(s.lastEvaluatedAt))
                      : t("never")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
