// Point d'arrivée du lien de vérification : Better Auth valide le jeton puis redirige ici,
// avec ?error=… si le jeton est invalide ou expiré. En cas de succès, l'utilisateur est connecté.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AFTER_SIGN_IN_PATH } from "@/lib/auth-client";
import { safePath } from "@/lib/safe-path";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const t = await getTranslations("verifyEmail");
  const tc = await getTranslations("common");
  return (
    <main>
      <h1>{t("title")}</h1>
      {error ? (
        <>
          <p role="alert">{t("invalid")}</p>
          <Link href="/sign-in">{tc("backToSignIn")}</Link>
        </>
      ) : (
        <>
          <p role="status">{t("done")}</p>
          <Link href={safePath(next, AFTER_SIGN_IN_PATH)}>{t("continue")}</Link>
        </>
      )}
    </main>
  );
}
