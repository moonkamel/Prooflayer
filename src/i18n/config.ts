// Langues de l'interface et des emails (§4.2, §5.2) : français et anglais.
export const locales = ["fr", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "fr";

// Cookie de préférence de langue ; sans lui, la langue suit l'en-tête Accept-Language.
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

/** Choisit la langue à partir du cookie, puis de l'en-tête Accept-Language, puis la langue par défaut. */
export function resolveLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | null,
): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0]?.trim().toLowerCase().slice(0, 2);
    if (isLocale(tag)) return tag;
  }
  return defaultLocale;
}

export async function loadMessages(locale: Locale) {
  return (await import(`../../messages/${locale}.json`))
    .default as typeof import("../../messages/fr.json");
}
