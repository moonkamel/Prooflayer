// Écrans hors espace connecté (PL-109) : inscription, connexion, vérification, 2FA, création de l'organisation,
// acceptation d'invitation. Colonne étroite centrée, sans navigation.
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { MAIN_ID, SkipLink } from "@/components/shell/skip-link";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("shell");
  return (
    <>
      <SkipLink />
      <header className="mx-auto flex max-w-md items-center justify-between px-4 py-4">
        <span className="font-semibold">{t("brand")}</span>
        <LanguageSwitcher />
      </header>
      <main id={MAIN_ID} className="mx-auto max-w-md space-y-4 px-4 pb-12">
        {children}
      </main>
    </>
  );
}
