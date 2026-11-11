import { getTranslations } from "next-intl/server";
import { safePath } from "@/lib/safe-path";
import { googleEnabled } from "@/server/auth";
import { SignInForm } from "./sign-in-form";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const t = await getTranslations("signIn");
  const target = safePath(next, "");
  return (
    <main>
      <h1>{t("title")}</h1>
      <SignInForm googleEnabled={googleEnabled} next={target || null} />
    </main>
  );
}
