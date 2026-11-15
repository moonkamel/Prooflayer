// Emails de suppression d'une organisation (PL-607) : avis de purge programmée (demande d'un owner ou fin de contrat)
// et confirmation une fois la purge faite et la clé de chiffrement détruite. Dans la langue du destinataire.
import { createTranslator } from "next-intl";
import { defaultLocale, isLocale, loadMessages, type Locale } from "@/i18n/config";
import type { EmailMessage } from "./transport";

const localeOf = (value: unknown): Locale => (isLocale(value) ? value : defaultLocale);

export interface DeletionRecipient {
  email: string;
  name: string;
  locale?: unknown;
}

async function translator(locale: Locale) {
  return createTranslator({
    locale,
    messages: await loadMessages(locale),
    namespace: "emails.orgDeletion",
  });
}

const day = (date: Date, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date);

export async function renderDeletionScheduledEmail(
  to: DeletionRecipient,
  data: {
    organization: string;
    reason: "owner_request" | "contract_end";
    scheduledFor: Date;
    baseUrl: string;
  },
): Promise<EmailMessage> {
  const locale = localeOf(to.locale);
  const t = await translator(locale);
  const params = {
    name: to.name,
    organization: data.organization,
    date: day(data.scheduledFor, locale),
  };
  return {
    to: to.email,
    subject: t("scheduledSubject", params),
    text: [
      t(data.reason === "contract_end" ? "scheduledContractEnd" : "scheduledOwnerRequest", params),
      t("scheduledWhat"),
      t("scheduledCancel", { url: new URL("/organization/data", data.baseUrl).toString() }),
    ].join("\n\n"),
  };
}

export async function renderOrgDeletedEmail(
  to: DeletionRecipient,
  data: { organization: string; completedAt: Date },
): Promise<EmailMessage> {
  const locale = localeOf(to.locale);
  const t = await translator(locale);
  const params = {
    name: to.name,
    organization: data.organization,
    date: day(data.completedAt, locale),
  };
  return {
    to: to.email,
    subject: t("deletedSubject", params),
    text: [t("deletedIntro", params), t("deletedBackups")].join("\n\n"),
  };
}
