// Fiche système, dossier d'exemption de l'Art. 6(3) (PL-205) : rédaction, signature, document PDF et champs de
// l'Annexe VIII section B. Écriture : owner et admin ; lecture : tout membre.
import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ADMIN_ROLES } from "@/server/services/role-policy";
import { requireSession } from "@/server/services/session";
import { Alert } from "@/components/ui/alert";
import { loadSystem } from "../load";
import { AnnexExportButtons, DossierForm, SignDossierDialog } from "./exemption-controls";

type Params = { params: Promise<{ id: string }> };

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { system } = await loadSystem((await params).id);
  return { title: `${(await getTranslations("exemption"))("title")} · ${system.name}` };
}

export default async function ExemptionPage({ params }: Params) {
  const session = await requireSession();
  const { api, system } = await loadSystem((await params).id);
  const [org, state] = await Promise.all([
    api.org.get(),
    api.exemption.get({ systemId: system.id }),
  ]);
  const canWrite = ADMIN_ROLES.includes(org.role) && !system.archivedAt;
  const t = await getTranslations("exemption");
  const tr = await getTranslations("classificationResult");
  const locale = await getLocale();
  const format = await getFormatter();
  const day = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "long", timeZone: "UTC" });
  const { dossier, classification } = state;

  return (
    <section aria-labelledby="exemption-title" className="max-w-3xl space-y-4">
      <h2 id="exemption-title">{t("title")}</h2>
      <p>{t("intro")}</p>
      {!state.applicable || !classification ? (
        <Alert>{t("notApplicable")}</Alert>
      ) : (
        <>
          <p data-testid="exemption-classification">
            {t("classificationRef", {
              date: classification.signedAt ? day(classification.signedAt) : "",
              points: classification.annexIIIPoints.join(", "),
              conditions: classification.art63Conditions.join(", "),
            })}
          </p>
          {dossier?.signature ? (
            <>
              <Alert data-testid="dossier-signature">
                {t("signedBy", {
                  date: day(dossier.signature.at),
                  name: dossier.signature.name ?? "",
                  title: dossier.signature.title ?? "",
                })}{" "}
                {dossier.signature.statement}
              </Alert>
              <dl className="space-y-3">
                <div>
                  <dt className="font-medium">{t("conditionJustification")}</dt>
                  <dd className="whitespace-pre-line">{dossier.conditionJustification}</dd>
                </div>
                <div>
                  <dt className="font-medium">{t("profilingJustification")}</dt>
                  <dd className="whitespace-pre-line">{dossier.profilingJustification}</dd>
                </div>
              </dl>
              <p>
                <a href={`/api/systems/${system.id}/exemption/document?lang=${locale}`} download>
                  {t("document")}
                </a>
              </p>
              <AnnexExportButtons systemId={system.id} />
            </>
          ) : canWrite ? (
            <>
              {dossier && <Alert>{t("draft")}</Alert>}
              <DossierForm
                systemId={system.id}
                initial={{
                  conditionJustification: dossier?.conditionJustification ?? "",
                  profilingJustification: dossier?.profilingJustification ?? "",
                  providerName: dossier?.providerName ?? state.defaults.providerName,
                  providerAddress: dossier?.providerAddress ?? "",
                  providerContact: dossier?.providerContact ?? "",
                  submitter: dossier?.submitter ?? "",
                  representative: dossier?.representative ?? "",
                  tradeName: dossier?.tradeName ?? state.defaults.tradeName,
                  memberStates: dossier?.memberStates ?? [],
                }}
              />
              {dossier && (
                <SignDossierDialog
                  systemId={system.id}
                  locale={locale}
                  defaultName={session.user.name}
                />
              )}
            </>
          ) : (
            <Alert>{dossier ? t("draft") : tr("readOnly")}</Alert>
          )}
        </>
      )}
    </section>
  );
}
