// Fiche système, onglet « Changements » : journal des modifications de conception, qualifiées significatives
// ou non avec motif (§3.2 E2, §5.3 écran B). Fondement de l'analyse de l'Art. 111(2).
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { ADMIN_ROLES } from "@/server/services/role-policy";
import { QualifyDesignChangeForm, RecordDesignChangeForm } from "../../system-controls";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { loadSystem } from "../load";

type Params = { params: Promise<{ id: string }> };

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { system } = await loadSystem((await params).id);
  return { title: `${(await getTranslations("designChanges"))("title")} · ${system.name}` };
}

export default async function DesignChangesPage({ params }: Params) {
  const { api, system } = await loadSystem((await params).id);
  const [org, changes] = await Promise.all([
    api.org.get(),
    api.system.designChanges.list({ systemId: system.id }),
  ]);
  const isAdmin = ADMIN_ROLES.includes(org.role);
  const t = await getTranslations("designChanges");
  const format = await getFormatter();
  const day = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "long", timeZone: "UTC" });

  return (
    <>
      <section aria-labelledby="changes-title" className="space-y-3">
        <h2 id="changes-title">{t("title")}</h2>
        <p>{t("intro")}</p>
        {changes.length === 0 ? (
          <p>{t("empty")}</p>
        ) : (
          <Table data-testid="design-changes">
            <thead>
              <tr>
                <TableHead scope="col">{t("date")}</TableHead>
                <TableHead scope="col">{t("summary")}</TableHead>
                <TableHead scope="col">{t("qualification")}</TableHead>
              </tr>
            </thead>
            <tbody>
              {changes.map((c) => (
                <tr key={c.id} data-testid="design-change">
                  <TableCell>
                    <time dateTime={c.occurredAt}>{day(c.occurredAt)}</time>
                  </TableCell>
                  <TableCell className="whitespace-pre-line">{c.summary}</TableCell>
                  <TableCell className="space-y-2">
                    <p data-testid="design-change-qualification">
                      <strong>
                        {c.isSignificant === null
                          ? t("toQualify")
                          : c.isSignificant
                            ? t("significant")
                            : t("notSignificant")}
                      </strong>
                    </p>
                    {c.qualifiedAt && (
                      <p className="text-sm text-muted-foreground">
                        {t("qualifiedBy", {
                          name: c.qualifiedBy?.name ?? "",
                          date: format.dateTime(new Date(c.qualifiedAt), { dateStyle: "short" }),
                          reason: c.qualificationReason ?? "",
                        })}
                      </p>
                    )}
                    {isAdmin && (
                      <QualifyDesignChangeForm
                        changeId={c.id}
                        current={c.isSignificant}
                        legend={t("qualifyLegend", { date: day(c.occurredAt) })}
                      />
                    )}
                  </TableCell>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      {isAdmin && !system.archivedAt && (
        <section aria-labelledby="record-title" className="space-y-3">
          <h2 id="record-title">{t("addTitle")}</h2>
          <RecordDesignChangeForm
            systemId={system.id}
            today={new Date().toISOString().slice(0, 10)}
          />
        </section>
      )}
    </>
  );
}
