// Page publique de vérification (PL-508, §3.2 E9) : un destinataire non technique dépose un pack et obtient un résultat
// en clair, avec le détail des six étapes du §4.6.3. Vérification exécutée dans le navigateur par @prooflayer/verify :
// le pack ne quitte pas le poste. Le serveur fournit seulement la confiance (clés publiques, racines d'horodatage).
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { verificationTrust } from "@/server/services/public-verification";
import { PackVerifier } from "./pack-verifier";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("publicVerify"))("title") };
}

export default async function PublicVerifyPage() {
  const t = await getTranslations("publicVerify");
  const trust = await verificationTrust();
  return (
    <>
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>
      <PackVerifier trust={trust} locale={(await getLocale()) === "en" ? "en" : "fr"} />
    </>
  );
}
