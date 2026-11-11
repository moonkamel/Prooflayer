// Point d'arrivée du lien de vérification : Better Auth valide le jeton puis redirige ici,
// avec ?error=… si le jeton est invalide ou expiré. En cas de succès, l'utilisateur est connecté.
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AFTER_SIGN_IN_PATH } from "@/lib/auth-client";
import { safePath } from "@/lib/safe-path";
import { Alert } from "@/components/ui/alert";

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("verifyEmail"))("title") };
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const t = await getTranslations("verifyEmail");
  const tc = await getTranslations("common");
  return (
    <div className="space-y-4">
      <h1>{t("title")}</h1>
      {error ? (
        <>
          <Alert tone="error">{t("invalid")}</Alert>
          <Link href="/sign-in">{tc("backToSignIn")}</Link>
        </>
      ) : (
        <>
          <Alert>{t("done")}</Alert>
          <Link href={safePath(next, AFTER_SIGN_IN_PATH)}>{t("continue")}</Link>
        </>
      )}
    </div>
  );
}
