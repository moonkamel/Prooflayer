// Questionnaire de classification (PL-203, §5.1 étape 3) : une question par écran, enregistrement automatique,
// reprise du brouillon en cours. Réservé à owner et admin (écriture, §4.4.2).
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { TRPCError } from "@trpc/server";
import { Alert } from "@/components/ui/alert";
import { loadSystem } from "../load";
import { Questionnaire } from "./questionnaire";

type Params = { params: Promise<{ id: string }> };

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { system } = await loadSystem((await params).id);
  return { title: `${(await getTranslations("questionnaire"))("title")} · ${system.name}` };
}

export default async function ClassificationPage({ params }: Params) {
  const { api, system } = await loadSystem((await params).id);
  const t = await getTranslations("questionnaire");
  let draft: Awaited<ReturnType<typeof api.classification.draft>>;
  try {
    draft = await api.classification.draft({ systemId: system.id });
  } catch (error) {
    if (error instanceof TRPCError && (error.code === "FORBIDDEN" || error.code === "CONFLICT")) {
      return (
        <section aria-labelledby="questionnaire-title" className="space-y-3">
          <h2 id="questionnaire-title">{t("title")}</h2>
          <Alert tone="error">{error.code === "FORBIDDEN" ? t("forbidden") : t("archived")}</Alert>
        </section>
      );
    }
    throw error;
  }
  return <Questionnaire systemId={system.id} initial={draft} locale={await getLocale()} />;
}
