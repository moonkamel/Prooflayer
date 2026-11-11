import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage() {
  const t = await getTranslations("forgotPassword");
  return (
    <main>
      <h1>{t("title")}</h1>
      <ForgotPasswordForm />
    </main>
  );
}
