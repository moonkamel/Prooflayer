// Pied de page des trois coques (PL-606) : documents contractuels, centre de confiance, vérification des packs.
import Link from "next/link";
import { getTranslations } from "next-intl/server";

const LINKS = [
  ["terms", "/legal/terms"],
  ["dpa", "/legal/dpa"],
  ["privacy", "/legal/privacy"],
  ["notice", "/legal/notice"],
  ["trust", "/trust"],
  ["verify", "/verify"],
] as const;

export async function LegalFooter({
  width = "max-w-6xl",
  fullReload = false,
}: {
  width?: string;
  /** Site public en anglais : rechargement complet, pour que la page suivante reprenne la langue de l'utilisateur. */
  fullReload?: boolean;
}) {
  const t = await getTranslations("legal.footer");
  return (
    <footer className={`mx-auto ${width} border-t px-4 py-6 text-sm`}>
      <nav aria-label={t("label")}>
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {LINKS.map(([key, href]) => (
            <li key={key}>
              {fullReload ? <a href={href}>{t(key)}</a> : <Link href={href}>{t(key)}</Link>}
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
