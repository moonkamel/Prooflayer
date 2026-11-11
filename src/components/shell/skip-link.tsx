import { getTranslations } from "next-intl/server";

export const MAIN_ID = "contenu";

/** Premier élément focalisable : saute la navigation (§5.2, navigation complète au clavier). */
export async function SkipLink() {
  const t = await getTranslations("shell");
  return (
    <a
      href={`#${MAIN_ID}`}
      className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
    >
      {t("skipToContent")}
    </a>
  );
}
