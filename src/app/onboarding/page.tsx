// Création de l'organisation (§5.1, écran 1 : « Organisation créée, essai de 14 jours démarré »).
// Le nom saisi à l'inscription arrive par ?name=… ; l'essai (Subscription) sera créé avec la facturation (PL-601).
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AFTER_SIGN_IN_PATH } from "@/lib/auth-client";
import { listOwnMemberships } from "@/server/services/organization";
import { getCurrentSession, SIGN_IN_PATH } from "@/server/services/session";
import { createOrganizationAction } from "./actions";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string }>;
}) {
  const session = await getCurrentSession();
  if (!session) redirect(SIGN_IN_PATH);
  if ((await listOwnMemberships(session.user.id)).length > 0) redirect(AFTER_SIGN_IN_PATH);

  const { name } = await searchParams;
  const t = await getTranslations("onboarding");
  return (
    <main>
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>
      <form action={createOrganizationAction}>
        <label>
          {t("name")}
          <input name="name" defaultValue={name?.slice(0, 120) ?? ""} maxLength={120} required />
        </label>
        <button type="submit">{t("submit")}</button>
      </form>
    </main>
  );
}
