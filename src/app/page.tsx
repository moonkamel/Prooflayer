// Accueil : nom de la marque et accès à la connexion ou à l'inscription.
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { MAIN_ID, SkipLink } from "@/components/shell/skip-link";

export default async function HomePage() {
  const t = await getTranslations("home");
  return (
    <>
      <SkipLink />
      <main id={MAIN_ID} className="mx-auto max-w-md space-y-4 px-4 py-12">
        <h1>{t("title")}</h1>
        <p className="text-muted-foreground">{t("tagline")}</p>
        <p className="flex gap-2">
          <Link href="/sign-up" className={buttonVariants()}>
            {t("signUp")}
          </Link>
          <Link href="/sign-in" className={buttonVariants({ variant: "outline" })}>
            {t("signIn")}
          </Link>
        </p>
      </main>
    </>
  );
}
