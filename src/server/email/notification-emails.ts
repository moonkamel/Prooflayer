// Emails d'alerte (PL-408, §3.2 E12) : régression d'un contrôle et résumé quotidien, rédigés dans la langue du
// destinataire à partir de messages/{fr,en}.json. Liens vers l'application (BETTER_AUTH_URL) ; jamais de charge de
// preuve (§8.2), seulement des clés de contrôle, des noms de systèmes et le résumé d'une preuve.
import { createTranslator } from "next-intl";
import { defaultLocale, isLocale, loadMessages, type Locale } from "@/i18n/config";
import {
  ALERT_MAX_REASONS,
  DIGEST_MAX_LINES,
  type OrgDigest,
} from "@/server/services/notifications-data";
import type { EmailMessage } from "./transport";

const localeOf = (value: unknown): Locale => (isLocale(value) ? value : defaultLocale);
const link = (base: string, path: string) => new URL(path, base).toString();

export interface ControlFailedEmail {
  to: string;
  name: string;
  locale?: unknown;
  baseUrl: string;
  organization: string;
  system: { id: string; name: string };
  control: { id: string; key: string; title: { fr: string; en: string } };
  reasons: { fr: string; en: string }[];
}

export async function renderControlFailedEmail(data: ControlFailedEmail): Promise<EmailMessage> {
  const locale = localeOf(data.locale);
  const t = createTranslator({
    locale,
    messages: await loadMessages(locale),
    namespace: "emails.controlFailed",
  });
  const shown = data.reasons.slice(0, ALERT_MAX_REASONS).map((r) => `- ${r[locale]}`);
  if (data.reasons.length > ALERT_MAX_REASONS) {
    shown.push(t("moreReasons", { count: data.reasons.length - ALERT_MAX_REASONS }));
  }
  const params = {
    name: data.name,
    key: data.control.key,
    title: data.control.title[locale],
    system: data.system.name,
    organization: data.organization,
  };
  return {
    to: data.to,
    subject: t("subject", params),
    text: [
      t("intro", params),
      shown.length ? `${t("reasons")}\n${shown.join("\n")}` : null,
      t("open", {
        url: link(data.baseUrl, `/systems/${data.system.id}/controls/${data.control.id}`),
      }),
      t("footer", { url: link(data.baseUrl, "/notifications") }),
    ]
      .filter((p): p is string => p !== null)
      .join("\n\n"),
  };
}

export interface DigestEmail {
  to: string;
  name: string;
  locale?: unknown;
  baseUrl: string;
  organizations: { name: string; digest: OrgDigest }[];
}

export async function renderDigestEmail(data: DigestEmail): Promise<EmailMessage> {
  const locale = localeOf(data.locale);
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "emails.digest" });
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(iso));
  const capped = <T>(items: T[], line: (item: T) => string) => {
    const lines = items.slice(0, DIGEST_MAX_LINES).map((i) => `- ${line(i)}`);
    if (items.length > DIGEST_MAX_LINES) {
      lines.push(t("more", { count: items.length - DIGEST_MAX_LINES }));
    }
    return lines.join("\n");
  };
  const sections = data.organizations.map(({ name, digest }) => {
    const parts = [`## ${name}`];
    if (digest.expiring.length) {
      parts.push(
        `${t("expiring", { count: digest.expiring.length })}\n${capped(digest.expiring, (e) =>
          t("expiringLine", {
            key: e.controlKey,
            system: e.systemName,
            evidence: e.evidenceSummary,
            date: date(e.validUntil),
            url: link(data.baseUrl, `/systems/${e.systemId}/controls/${e.controlInstanceId}`),
          }),
        )}`,
      );
    }
    if (digest.integrations.length) {
      parts.push(
        `${t("integrations", { count: digest.integrations.length })}\n${capped(
          digest.integrations,
          (i) =>
            t("integrationLine", {
              provider: i.provider,
              status: t(`integrationStatus.${i.status as "ERROR"}`),
            }),
        )}\n${t("integrationsLink", { url: link(data.baseUrl, "/organization") })}`,
      );
    }
    if (digest.staleClassifications.length) {
      parts.push(
        `${t("stale", { count: digest.staleClassifications.length })}\n${capped(
          digest.staleClassifications,
          (s) =>
            t("staleLine", {
              system: s.systemName,
              url: link(data.baseUrl, `/systems/${s.systemId}/classification`),
            }),
        )}`,
      );
    }
    return parts.join("\n\n");
  });
  return {
    to: data.to,
    subject: t("subject"),
    text: [
      t("intro", { name: data.name }),
      ...sections,
      t("footer", { url: link(data.baseUrl, "/notifications") }),
    ].join("\n\n"),
  };
}

export interface PackReadyEmail {
  to: string;
  name: string;
  locale?: unknown;
  baseUrl: string;
  organization: string;
  system: { id: string; name: string };
  evidenceCount: number;
}

/** Pack d'audit prêt (PL-504). */
export async function renderPackReadyEmail(data: PackReadyEmail): Promise<EmailMessage> {
  const locale = localeOf(data.locale);
  const t = createTranslator({
    locale,
    messages: await loadMessages(locale),
    namespace: "emails.packReady",
  });
  const params = { name: data.name, system: data.system.name, organization: data.organization };
  return {
    to: data.to,
    subject: t("subject", params),
    text: [
      t("intro", { ...params, count: data.evidenceCount }),
      t("open", { url: link(data.baseUrl, `/systems/${data.system.id}/packs`) }),
      t("verify"),
    ].join("\n\n"),
  };
}

export interface WatchPublishedEmail {
  to: string;
  name: string;
  locale?: unknown;
  baseUrl: string;
  organization: string;
  entry: {
    id: string;
    title: { fr: string; en: string };
    summary: { fr: string; en: string };
    source: { fr: string; en: string };
    effectiveDate: Date | null;
    controls: string[];
  };
}

/** Nouvelle entrée du fil de veille (PL-603) : titre, date d'effet, résumé, source, contrôles concernés. */
export async function renderWatchPublishedEmail(data: WatchPublishedEmail): Promise<EmailMessage> {
  const locale = localeOf(data.locale);
  const t = createTranslator({
    locale,
    messages: await loadMessages(locale),
    namespace: "emails.watchPublished",
  });
  const date = data.entry.effectiveDate
    ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "fr-FR", {
        dateStyle: "long",
        timeZone: "UTC",
      }).format(data.entry.effectiveDate)
    : null;
  const title = data.entry.title[locale];
  return {
    to: data.to,
    subject: t("subject", { title }),
    text: [
      t("intro", { name: data.name, organization: data.organization }),
      title,
      date ? t("effective", { date }) : null,
      data.entry.summary[locale],
      t("source", { source: data.entry.source[locale] }),
      data.entry.controls.length
        ? t("controls", { controls: data.entry.controls.join(", ") })
        : null,
      t("open", { url: link(data.baseUrl, `/watch#${data.entry.id}`) }),
      t("footer", { url: link(data.baseUrl, "/notifications") }),
    ]
      .filter((p): p is string => p !== null)
      .join("\n\n"),
  };
}
