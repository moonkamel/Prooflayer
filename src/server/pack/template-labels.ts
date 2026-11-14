// Libellés des gabarits du pack (PL-506) dans une langue : textes `packTemplates` et énumérations traduites.
import { createTranslator } from "next-intl";
import { loadMessages, type Locale } from "@/i18n/config";
import type { Labels } from "./templates";

/** Libellés des gabarits (PL-506) dans la langue du pack. */
export async function templateLabels(locale: Locale): Promise<Labels> {
  const messages = await loadMessages(locale);
  const make = (namespace: string) =>
    createTranslator({ locale, messages, namespace: namespace as "packTemplates" });
  const t = make("packTemplates");
  const enumLabel = (namespace: string) => {
    const tr = make(namespace);
    return (value: string) => tr(value as never);
  };
  return {
    t: (key, values) => t(key as never, values as never),
    raw: (key) => t.raw(key as never),
    role: enumLabel("aiActRole"),
    systemStatus: enumLabel("systemStatus"),
    tier: enumLabel("riskTier"),
    controlStatus: enumLabel("controlStatus"),
  };
}
