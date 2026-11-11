// Activation de la 2FA. Hors de l'espace connecté protégé, sinon la garde des owner/admin redirigerait en boucle.
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AFTER_SIGN_IN_PATH } from "@/lib/auth-client";
import {
  getCurrentSession,
  isTwoFactorSetupRequired,
  SIGN_IN_PATH,
} from "@/server/services/session";
import { TwoFactorSetup } from "./two-factor-setup";

export default async function SetupTwoFactorPage() {
  const session = await getCurrentSession();
  if (!session) redirect(SIGN_IN_PATH);
  if (session.user.twoFactorEnabled) redirect(AFTER_SIGN_IN_PATH);
  const required = await isTwoFactorSetupRequired(session);
  const t = await getTranslations("twoFactorSetup");
  return (
    <main>
      <h1>{t("title")}</h1>
      <p role={required ? "alert" : undefined}>{required ? t("required") : t("optional")}</p>
      <TwoFactorSetup />
    </main>
  );
}
