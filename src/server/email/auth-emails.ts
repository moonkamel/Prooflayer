// Emails d'authentification, rédigés dans la langue de l'utilisateur à partir de messages/{fr,en}.json.
import { createTranslator } from "next-intl";
import { defaultLocale, isLocale, loadMessages } from "@/i18n/config";
import type { EmailMessage, EmailTransport } from "./transport";

export type AuthEmailKind = "verify" | "resetPassword";

export interface AuthEmailRecipient {
  email: string;
  name: string;
  locale?: unknown;
}

export async function renderAuthEmail(
  kind: AuthEmailKind,
  user: AuthEmailRecipient,
  url: string,
): Promise<EmailMessage> {
  const locale = isLocale(user.locale) ? user.locale : defaultLocale;
  const t = createTranslator({ locale, messages: await loadMessages(locale), namespace: "emails" });
  return {
    to: user.email,
    subject: t(`${kind}.subject`),
    text: t(`${kind}.body`, { name: user.name, url }),
  };
}

export async function sendAuthEmail(
  transport: EmailTransport,
  kind: AuthEmailKind,
  user: AuthEmailRecipient,
  url: string,
): Promise<void> {
  await transport.send(await renderAuthEmail(kind, user, url));
}
