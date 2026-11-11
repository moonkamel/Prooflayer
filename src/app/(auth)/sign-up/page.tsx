import { getTranslations } from "next-intl/server";
import { googleEnabled } from "@/server/auth";
import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage() {
  const t = await getTranslations("signUp");
  return (
    <main>
      <h1>{t("title")}</h1>
      <SignUpForm googleEnabled={googleEnabled} />
    </main>
  );
}
