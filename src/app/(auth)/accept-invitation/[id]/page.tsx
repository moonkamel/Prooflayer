// Lien reçu par email. Hors de l'espace connecté : l'invité n'a pas encore d'organisation.
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { checkInvitationFor } from "@/server/services/organization";
import { getCurrentSession } from "@/server/services/session";
import { AcceptInvitationButton } from "./accept-button";
import { Alert } from "@/components/ui/alert";

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("acceptInvitation"))("title") };
}

export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations("acceptInvitation");
  const session = await getCurrentSession();
  const here = `/accept-invitation/${encodeURIComponent(id)}`;

  if (!session) {
    // Sans session, rien n'est révélé de l'invitation : ni organisation, ni adresse.
    return (
      <div className="space-y-4">
        <h1>{t("title")}</h1>
        <p>{t("intro")}</p>
        <p>
          <Link href={`/sign-in?next=${encodeURIComponent(here)}`}>{t("signIn")}</Link>
        </p>
        <p>
          <Link href={`/sign-up?next=${encodeURIComponent(here)}`}>{t("signUp")}</Link>
        </p>
      </div>
    );
  }

  const check = await checkInvitationFor(id, session.user.email);

  return (
    <div className="space-y-4">
      <h1>{t("title")}</h1>
      {check === "invalid" ? (
        <Alert tone="error">{t("invalid")}</Alert>
      ) : check === "wrongAccount" ? (
        <Alert tone="error">{t("wrongAccount", { email: session.user.email })}</Alert>
      ) : (
        <>
          <p>{t("intro")}</p>
          <AcceptInvitationButton invitationId={id} />
        </>
      )}
    </div>
  );
}
