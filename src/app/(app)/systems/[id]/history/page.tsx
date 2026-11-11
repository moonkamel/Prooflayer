// Fiche système, onglet « Historique » : chaque modification de la fiche, qui, quand, avant, après (§3.2 E2).
// Source : le journal d'audit en ajout seul (PL-106), entrées ciblant ce système.
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import type { AiActRole, SystemStatus } from "@/generated/prisma/enums";
import type { HistoryValue, SystemField } from "@/server/services/system-registry";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { loadSystem } from "../load";

type Params = { params: Promise<{ id: string }> };

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { system } = await loadSystem((await params).id);
  return { title: `${(await getTranslations("systemHistory"))("title")} · ${system.name}` };
}

export default async function SystemHistoryPage({ params }: Params) {
  const { api, system } = await loadSystem((await params).id);
  const { entries, people } = await api.system.history({ id: system.id });
  const t = await getTranslations("systemHistory");
  const tf = await getTranslations("systemFields");
  const tr = await getTranslations("aiActRole");
  const ts = await getTranslations("systemStatus");
  const format = await getFormatter();

  /** Valeur lisible : libellés traduits, dates formatées, responsables par leur nom. */
  const show = (field: string, value: HistoryValue) => {
    if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
      return <span className="text-muted-foreground">{t("emptyValue")}</span>;
    }
    if (typeof value === "string") {
      if (field === "role") return tr(value as AiActRole);
      if (field === "status") return ts(value as SystemStatus);
      if (field === "placedOnMarketAt") {
        return format.dateTime(new Date(value), { dateStyle: "long", timeZone: "UTC" });
      }
      if (field === "ownerUserId" || field === "oversightOwnerUserId") {
        return people[value] ?? value;
      }
    }
    if (Array.isArray(value)) {
      return value
        .map((v) => (typeof v === "string" ? v : [v.name, v.version].filter(Boolean).join(" ")))
        .join(", ");
    }
    return String(value);
  };

  return (
    <section aria-labelledby="history-title" className="space-y-3">
      <h2 id="history-title">{t("title")}</h2>
      <p>{t("intro")}</p>
      {entries.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <Table data-testid="system-history">
          <thead>
            <tr>
              <TableHead scope="col">{t("date")}</TableHead>
              <TableHead scope="col">{t("author")}</TableHead>
              <TableHead scope="col">{t("field")}</TableHead>
              <TableHead scope="col">{t("before")}</TableHead>
              <TableHead scope="col">{t("after")}</TableHead>
            </tr>
          </thead>
          <tbody>
            {entries.flatMap((e) => {
              const when = (
                <time dateTime={e.at}>
                  {format.dateTime(new Date(e.at), { dateStyle: "long", timeStyle: "short" })}
                </time>
              );
              const author = e.actor ? `${e.actor.name} (${e.actor.email})` : t("unknownActor");
              if (e.changes.length === 0) {
                return [
                  <tr key={e.id} data-testid="history-entry" data-action={e.action}>
                    <TableCell>{when}</TableCell>
                    <TableCell>{author}</TableCell>
                    <TableCell colSpan={3}>
                      {e.action === "system.archive" ? t("archived") : t("created")}
                    </TableCell>
                  </tr>,
                ];
              }
              return e.changes.map((c) => (
                <tr
                  key={`${e.id}-${c.field}`}
                  data-testid="history-entry"
                  data-action={e.action}
                  data-field={c.field}
                >
                  <TableCell>{when}</TableCell>
                  <TableCell>{author}</TableCell>
                  <TableCell>{tf(c.field as SystemField)}</TableCell>
                  <TableCell>{show(c.field, c.before)}</TableCell>
                  <TableCell>{show(c.field, c.after)}</TableCell>
                </tr>
              ));
            })}
          </tbody>
        </Table>
      )}
    </section>
  );
}
