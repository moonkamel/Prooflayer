// next-intl sans préfixe de langue dans l'URL : la langue vient du cookie NEXT_LOCALE ou d'Accept-Language.
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, loadMessages, resolveLocale } from "./config";

export default getRequestConfig(async () => {
  const locale = resolveLocale(
    (await cookies()).get(LOCALE_COOKIE)?.value,
    (await headers()).get("accept-language"),
  );
  return { locale, messages: await loadMessages(locale) };
});
