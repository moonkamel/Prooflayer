// next-intl sans préfixe de langue dans l'URL : la langue vient du cookie NEXT_LOCALE ou d'Accept-Language.
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { isLocale, LOCALE_COOKIE, loadMessages, resolveLocale, SITE_LOCALE_HEADER } from "./config";

export default getRequestConfig(async () => {
  const requestHeaders = await headers();
  // Site public en anglais (pages de `ENGLISH_ONLY_PATHS`) : en-tête posé par le proxy, jamais par le client.
  const forced = requestHeaders.get(SITE_LOCALE_HEADER);
  const locale = isLocale(forced)
    ? forced
    : resolveLocale(
        (await cookies()).get(LOCALE_COOKIE)?.value,
        requestHeaders.get("accept-language"),
      );
  return { locale, messages: await loadMessages(locale) };
});
