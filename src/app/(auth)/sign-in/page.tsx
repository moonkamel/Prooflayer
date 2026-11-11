import { getTranslations } from "next-intl/server";
import { googleEnabled } from "@/server/auth";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage() {
  const t = await getTranslations("signIn");
  return (
    <main>
      <h1>{t("title")}</h1>
      <SignInForm googleEnabled={googleEnabled} />
    </main>
  );
}
