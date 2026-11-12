// Fiche système, onglet « Sources » (PL-404) : les quatre correspondances Jira du système (§3.2 E4), avec
// prévisualisation du nombre de tickets avant enregistrement. Les dépôts GitHub s'y ajouteront avec PL-303.
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { ADMIN_ROLES } from "@/server/services/role-policy";
import { loadSystem } from "../load";
import { JiraMappingForm } from "./jira-mapping-form";

type Params = { params: Promise<{ id: string }> };

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { system } = await loadSystem((await params).id);
  return { title: `${(await getTranslations("sources"))("title")} · ${system.name}` };
}

export default async function SystemSourcesPage({ params }: Params) {
  const { api, system } = await loadSystem((await params).id);
  const t = await getTranslations("sources");
  const [jira, org] = await Promise.all([
    api.integration.jira.mappings({ systemId: system.id }),
    api.org.get(),
  ]);
  const canEdit = ADMIN_ROLES.includes(org.role) && !system.archivedAt;

  return (
    <section aria-labelledby="sources-title" className="space-y-4">
      <h2 id="sources-title">{t("title")}</h2>
      <h3>{t("jira.title")}</h3>
      {!jira.integration ? (
        <Alert>
          {t("jira.notConnected")} <a href="/organization">{t("jira.connectLink")}</a>
        </Alert>
      ) : (
        <>
          <p>{t("jira.site", { name: jira.integration.name })}</p>
          {jira.integration.status !== "ACTIVE" && <Alert tone="error">{t("jira.inactive")}</Alert>}
          <p className="text-sm text-muted-foreground">{t("jira.help")}</p>
          {jira.mappings.map((m) => (
            <JiraMappingForm
              key={m.purpose}
              systemId={system.id}
              integrationId={jira.integration!.id}
              purpose={m.purpose}
              jql={m.jql}
              defaultJql={m.defaultJql}
              acceptanceField={m.acceptanceField}
              canEdit={canEdit && jira.integration!.status === "ACTIVE"}
            />
          ))}
        </>
      )}
    </section>
  );
}
