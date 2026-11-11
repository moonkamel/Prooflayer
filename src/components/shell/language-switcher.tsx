"use client";

// Choix de la langue (§5.2 : français et anglais) : cookie NEXT_LOCALE lu par src/i18n/request.ts.
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { LOCALE_COOKIE, locales, type Locale } from "@/i18n/config";
import { Select } from "@/components/ui/input";

export function LanguageSwitcher() {
  const t = useTranslations("shell");
  const names = useTranslations("common.languageNames");
  const locale = useLocale();
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {t("language")}
      <Select
        value={locale}
        onChange={(event) => {
          const next = event.target.value as Locale;
          document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
          router.refresh();
        }}
        className="h-8"
      >
        {locales.map((l) => (
          <option key={l} value={l} lang={l}>
            {names(l)}
          </option>
        ))}
      </Select>
    </label>
  );
}
