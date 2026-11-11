// Point d'arrivée du lien de réinitialisation : Better Auth redirige ici avec ?token=… ou ?error=….
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const t = await getTranslations("resetPassword");
  const tc = await getTranslations("common");
  return (
    <main>
      <h1>{t("title")}</h1>
      {token && !error ? (
        <ResetPasswordForm token={token} />
      ) : (
        <>
          <p role="alert">{t("invalid")}</p>
          <Link href="/sign-in">{tc("backToSignIn")}</Link>
        </>
      )}
    </main>
  );
}
