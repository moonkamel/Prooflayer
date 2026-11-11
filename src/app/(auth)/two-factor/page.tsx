import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { safePath } from "@/lib/safe-path";
import { TwoFactorForm } from "./two-factor-form";

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("twoFactorChallenge"))("title") };
}

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const t = await getTranslations("twoFactorChallenge");
  const target = safePath(next, "");
  return (
    <div className="space-y-4">
      <h1>{t("title")}</h1>
      <TwoFactorForm next={target || null} />
    </div>
  );
}
