// Point d'arrivée du lien de réinitialisation : Better Auth redirige ici avec ?token=… ou ?error=….
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ResetPasswordForm } from "./reset-password-form";
import { Alert } from "@/components/ui/alert";

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("resetPassword"))("title") };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const t = await getTranslations("resetPassword");
  const tc = await getTranslations("common");
  return (
    <div className="space-y-4">
      <h1>{t("title")}</h1>
      {token && !error ? (
        <ResetPasswordForm token={token} />
      ) : (
        <>
          <Alert tone="error">{t("invalid")}</Alert>
          <Link href="/sign-in">{tc("backToSignIn")}</Link>
        </>
      )}
    </div>
  );
}
