import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "./forgot-password-form";

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("forgotPassword"))("title") };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("forgotPassword");
  return (
    <div className="space-y-4">
      <h1>{t("title")}</h1>
      <ForgotPasswordForm />
    </div>
  );
}
