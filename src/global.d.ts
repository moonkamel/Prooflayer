// Typage des clés de traduction : une clé absente de messages/fr.json est une erreur de compilation.
import type messages from "../messages/fr.json";
import type { Locale } from "./i18n/config";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
