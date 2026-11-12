// Classifieur public (PL-208, §7.2 canal 2) : même moteur que l'espace connecté, sans compte. Les réponses restent
// dans le navigateur ; un lien partageable (`?r=`) les préremplit.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { decodeResponses } from "@/server/classify/share";
import { PublicClassifier } from "./public-classifier";

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("publicClassifier"))("title") };
}

export default async function PublicClassifierPage({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>;
}) {
  const t = await getTranslations("publicClassifier");
  const initial = decodeResponses((await searchParams).r);
  // Origine publique du lien partageable : celle de la requête (hébergeur derrière un proxy compris).
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? ""}`;
  return (
    <>
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>
      <PublicClassifier initial={initial} locale={await getLocale()} origin={origin} />
    </>
  );
}
