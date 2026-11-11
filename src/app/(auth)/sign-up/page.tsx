import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { safePath } from "@/lib/safe-path";
import { googleEnabled } from "@/server/auth";
import { SignUpForm } from "./sign-up-form";

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("signUp"))("title") };
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const t = await getTranslations("signUp");
  const target = safePath(next, "");
  return (
    <div className="space-y-4">
      <h1>{t("title")}</h1>
      <SignUpForm googleEnabled={googleEnabled} next={target || null} />
    </div>
  );
}
