// Activation de la 2FA. Hors de l'espace connecté protégé, sinon la garde des owner/admin redirigerait en boucle.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AFTER_SIGN_IN_PATH } from "@/lib/auth-client";
import {
  getCurrentSession,
  isTwoFactorSetupRequired,
  SIGN_IN_PATH,
} from "@/server/services/session";
import { TwoFactorSetup } from "./two-factor-setup";
import { Alert } from "@/components/ui/alert";

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("twoFactorSetup"))("title") };
}

export default async function SetupTwoFactorPage() {
  const session = await getCurrentSession();
  if (!session) redirect(SIGN_IN_PATH);
  if (session.user.twoFactorEnabled) redirect(AFTER_SIGN_IN_PATH);
  const required = await isTwoFactorSetupRequired(session);
  const t = await getTranslations("twoFactorSetup");
  return (
    <div className="space-y-4">
      <h1>{t("title")}</h1>
      <Alert tone={required ? "error" : "info"}>{required ? t("required") : t("optional")}</Alert>
      <TwoFactorSetup />
    </div>
  );
}
