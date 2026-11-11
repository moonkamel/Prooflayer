import { getTranslations } from "next-intl/server";
import { safePath } from "@/lib/safe-path";
import { googleEnabled } from "@/server/auth";
import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const t = await getTranslations("signUp");
  const target = safePath(next, "");
  return (
    <main>
      <h1>{t("title")}</h1>
      <SignUpForm googleEnabled={googleEnabled} next={target || null} />
    </main>
  );
}
