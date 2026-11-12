// Fiche système, onglet « Contrôles » (PL-207, écran B) : les contrôles ouverts par la classification signée, avec
// leur statut. L'évaluation et le détail d'un contrôle arrivent au sprint 4 (écrans C et D).
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { loadSystem } from "../load";

type Params = { params: Promise<{ id: string }> };

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { system } = await loadSystem((await params).id);
  return { title: `${(await getTranslations("controls"))("title")} · ${system.name}` };
}

export default async function SystemControlsPage({ params }: Params) {
  const { api, system } = await loadSystem((await params).id);
  const controls = await api.control.listBySystem({ systemId: system.id });
  const t = await getTranslations("controls");
  const locale = (await getLocale()) === "en" ? "en" : "fr";
  const applicable = controls.filter((c) => !c.notApplicable);

  return (
    <section aria-labelledby="controls-title" className="space-y-3">
      <h2 id="controls-title">{t("title")}</h2>
      {controls.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <>
          <p>{t("intro")}</p>
          <p data-testid="controls-summary">
            {t("summary", {
              count: applicable.length,
              automated: applicable.filter((c) => c.automation === "AUTOMATED").length,
            })}
          </p>
          <Table data-testid="controls">
            <thead>
              <tr>
                <TableHead scope="col">{t("control")}</TableHead>
                <TableHead scope="col">{t("article")}</TableHead>
                <TableHead scope="col">{t("evaluation")}</TableHead>
                <TableHead scope="col">{t("status")}</TableHead>
              </tr>
            </thead>
            <tbody>
              {controls.map((c) => (
                <tr key={c.id} data-testid="control" data-key={c.key}>
                  <TableCell>
                    <p className="font-medium">
                      <code>{c.key}</code> {c.title[locale]}
                    </p>
                    <p className="text-sm text-muted-foreground">{c.statement[locale]}</p>
                  </TableCell>
                  <TableCell>{c.articleRef}</TableCell>
                  <TableCell>{t(`automation.${c.automation}`)}</TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                    {!c.notApplicable && c.automation !== "AUTOMATED" && !system.archivedAt && (
                      <p className="mt-1 text-sm">
                        <a href={`/systems/${system.id}/controls/${c.id}/evidence`}>
                          {t("addEvidence")}
                          <span className="sr-only"> · {c.key}</span>
                        </a>
                      </p>
                    )}
                    {c.notApplicableByReclassification && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("byReclassification")}
                      </p>
                    )}
                  </TableCell>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </section>
  );
}
