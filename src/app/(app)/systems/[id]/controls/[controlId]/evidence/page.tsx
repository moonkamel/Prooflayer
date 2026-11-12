// Ajout d'une preuve à un contrôle (PL-405, §3.2 E5) : document déposé ou attestation signée, toujours déclaratifs.
// Le détail du contrôle (écran D) : ../page.tsx (PL-407).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { WRITE_ROLES } from "@/server/services/role-policy";
import { loadSystem } from "../../../load";
import { AttestForm, UploadForm } from "./evidence-forms";

type Params = { params: Promise<{ id: string; controlId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { system } = await loadSystem((await params).id);
  return { title: `${(await getTranslations("manualEvidence"))("title")} · ${system.name}` };
}

export default async function AddEvidencePage({ params }: Params) {
  const { id, controlId } = await params;
  const { api, system } = await loadSystem(id);
  const [controls, org] = await Promise.all([
    api.control.listBySystem({ systemId: system.id }),
    api.org.get(),
  ]);
  const control = controls.find((c) => c.id === controlId);
  if (!control || control.notApplicable) notFound();
  const t = await getTranslations("manualEvidence");
  const locale = (await getLocale()) === "en" ? "en" : "fr";
  const canWrite = WRITE_ROLES.includes(org.role) && !system.archivedAt;

  return (
    <section aria-labelledby="evidence-title" className="space-y-4">
      <h2 id="evidence-title">{t("title")}</h2>
      <p>
        <code>{control.key}</code> {control.title[locale]}
      </p>
      <p className="text-sm text-muted-foreground">{control.statement[locale]}</p>
      <Alert>{t("declarative")}</Alert>
      {canWrite ? (
        <>
          <UploadForm controlInstanceId={control.id} backHref={`/systems/${system.id}/controls`} />
          <AttestForm controlInstanceId={control.id} backHref={`/systems/${system.id}/controls`} />
        </>
      ) : (
        <Alert tone="error">{t("forbidden")}</Alert>
      )}
    </section>
  );
}
