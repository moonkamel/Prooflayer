// Écrans publics sans session (PL-208) : classifieur public. Colonne de lecture, sans navigation de l'espace connecté.
import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { MAIN_ID, SkipLink } from "@/components/shell/skip-link";

export default async function PublicLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("shell");
  return (
    <>
      <SkipLink />
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
        <Link href="/" className="font-semibold text-foreground no-underline">
          {t("brand")}
        </Link>
        <LanguageSwitcher />
      </header>
      <main id={MAIN_ID} className="mx-auto max-w-3xl space-y-6 px-4 pb-12">
        {children}
      </main>
    </>
  );
}
