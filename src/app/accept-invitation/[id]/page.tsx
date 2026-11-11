// Lien reçu par email. Hors de l'espace connecté : l'invité n'a pas encore d'organisation.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { checkInvitationFor } from "@/server/services/organization";
import { getCurrentSession } from "@/server/services/session";
import { AcceptInvitationButton } from "./accept-button";

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
      <main>
        <h1>{t("title")}</h1>
        <p>{t("intro")}</p>
        <p>
          <Link href={`/sign-in?next=${encodeURIComponent(here)}`}>{t("signIn")}</Link>
        </p>
        <p>
          <Link href={`/sign-up?next=${encodeURIComponent(here)}`}>{t("signUp")}</Link>
        </p>
      </main>
    );
  }

  const check = await checkInvitationFor(id, session.user.email);

  return (
    <main>
      <h1>{t("title")}</h1>
      {check === "invalid" ? (
        <p role="alert">{t("invalid")}</p>
      ) : check === "wrongAccount" ? (
        <p role="alert">{t("wrongAccount", { email: session.user.email })}</p>
      ) : (
        <>
          <p>{t("intro")}</p>
          <AcceptInvitationButton invitationId={id} />
        </>
      )}
    </main>
  );
}
