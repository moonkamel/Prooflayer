// Création de l'organisation (§5.1, écran 1 : « Organisation créée, essai de 14 jours démarré »).
// Le nom saisi à l'inscription arrive par ?name=… ; l'essai (Subscription) sera créé avec la facturation (PL-601).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AFTER_SIGN_IN_PATH } from "@/lib/auth-client";
import { listOwnMemberships } from "@/server/services/organization";
import { getCurrentSession, SIGN_IN_PATH } from "@/server/services/session";
import { createOrganizationAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("onboarding"))("title") };
}

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
    <div className="space-y-4">
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>
      <form className="max-w-md space-y-3" action={createOrganizationAction}>
        <Label>
          {t("name")}
          <Input name="name" defaultValue={name?.slice(0, 120) ?? ""} maxLength={120} required />
        </Label>
        <Button type="submit">{t("submit")}</Button>
      </form>
    </div>
  );
}
