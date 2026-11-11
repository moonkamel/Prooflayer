// Emails d'authentification et d'invitation, rédigés dans la langue du destinataire à partir de messages/{fr,en}.json.
import { createTranslator } from "next-intl";
import { defaultLocale, isLocale, loadMessages, type Locale } from "@/i18n/config";
import type { EmailMessage, EmailTransport } from "./transport";

export type AuthEmailKind = "verify" | "resetPassword";

export interface AuthEmailRecipient {
  email: string;
  name: string;
  locale?: unknown;
}

const localeOf = (value: unknown): Locale => (isLocale(value) ? value : defaultLocale);

export async function renderAuthEmail(
  kind: AuthEmailKind,
  user: AuthEmailRecipient,
  url: string,
): Promise<EmailMessage> {
  const locale = localeOf(user.locale);
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

export interface InvitationEmail {
  to: string;
  organization: string;
  inviter: string;
  role: string;
  url: string;
  /** Langue de l'invitant : celle du destinataire est inconnue tant qu'il n'a pas de compte. */
  locale?: unknown;
}

export async function renderInvitationEmail(data: InvitationEmail): Promise<EmailMessage> {
  const locale = localeOf(data.locale);
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "emails" });
  const roles = createTranslator({ locale, messages, namespace: "roles" });
  const role = (["owner", "admin", "contributor", "auditor"] as const).find((r) => r === data.role);
  const params = {
    organization: data.organization,
    inviter: data.inviter,
    role: role ? roles(role) : data.role,
    url: data.url,
  };
  return {
    to: data.to,
    subject: t("invitation.subject", params),
    text: t("invitation.body", params),
  };
}
