import { getTranslations } from "next-intl/server";
import { safePath } from "@/lib/safe-path";
import { TwoFactorForm } from "./two-factor-form";

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const t = await getTranslations("twoFactorChallenge");
  const target = safePath(next, "");
  return (
    <main>
      <h1>{t("title")}</h1>
      <TwoFactorForm next={target || null} />
    </main>
  );
}
