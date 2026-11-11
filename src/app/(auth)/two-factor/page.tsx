import { getTranslations } from "next-intl/server";
import { TwoFactorForm } from "./two-factor-form";

export default async function TwoFactorPage() {
  const t = await getTranslations("twoFactorChallenge");
  return (
    <main>
      <h1>{t("title")}</h1>
      <TwoFactorForm />
    </main>
  );
}
