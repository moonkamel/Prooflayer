// PL-608 — Transmission d'une étape de l'entonnoir à PostHog Cloud UE (§4.2), si POSTHOG_API_KEY est configurée.
// Envoi côté serveur, sans cookie : organisation pseudonymisée (HMAC), nom de l'étape et date, rien d'autre (§8.2 :
// « événements pseudonymisés », jamais de donnée de preuve ni de personne). L'identifiant de l'événement sert de
// `uuid` : un nouvel essai ne crée pas de doublon chez PostHog.
import { createHmac } from "node:crypto";
import { z } from "zod";
import { enqueueInTransaction } from "./queue";
import { defineJob } from "./registry";
import type { OrgTransaction } from "@/server/db";

export const POSTHOG_DEFAULT_HOST = "https://eu.i.posthog.com";

export interface AnalyticsConfig {
  apiKey: string;
  host: string;
  secret: string;
}

export function analyticsConfig(env: Record<string, string | undefined> = process.env) {
  const apiKey = env.POSTHOG_API_KEY?.trim();
  if (!apiKey || !env.BETTER_AUTH_SECRET) return null;
  const host = (env.POSTHOG_HOST?.trim() || POSTHOG_DEFAULT_HOST).replace(/\/+$/u, "");
  if (!/^https:\/\/[a-z0-9.-]+$/u.test(host)) return null;
  return { apiKey, host, secret: env.BETTER_AUTH_SECRET } satisfies AnalyticsConfig;
}

/** Identifiant pseudonyme stable d'une organisation chez PostHog. */
export const pseudonymousOrg = (orgId: string, secret: string) =>
  `org_${createHmac("sha256", `posthog:${secret}`).update(orgId).digest("hex").slice(0, 24)}`;

export function captureBody(
  config: AnalyticsConfig,
  event: { id: string; orgId: string; name: string; occurredAt: Date },
) {
  return {
    api_key: config.apiKey,
    event: `funnel_${event.name}`,
    distinct_id: pseudonymousOrg(event.orgId, config.secret),
    uuid: event.id,
    timestamp: event.occurredAt.toISOString(),
    properties: { $process_person_profile: false },
  };
}

/** Dépendances remplaçables par les tests. */
export const analyticsDependencies: {
  config: () => AnalyticsConfig | null;
  fetch: typeof fetch;
} = { config: () => analyticsConfig(), fetch: (...args) => fetch(...args) };

export const analyticsCaptureJob = defineJob({
  type: "analytics.capture",
  schema: z.object({ eventId: z.string().uuid() }),
  handle: async ({ eventId }, ctx) => {
    const config = analyticsDependencies.config();
    const event = await ctx.tx.funnelEvent.findUnique({ where: { id: eventId } });
    if (!config || !event || event.sentAt) return;
    const response = await analyticsDependencies.fetch(`${config.host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(captureBody(config, event)),
      signal: AbortSignal.timeout(10_000),
    });
    // Erreur sans corps de réponse (règle 8) : seul le statut est gardé.
    if (!response.ok) throw new Error(`PostHog : HTTP ${response.status}`);
    await ctx.tx.funnelEvent.update({ where: { id: eventId }, data: { sentAt: new Date() } });
  },
});

export const scheduleAnalyticsCapture = (tx: OrgTransaction, orgId: string, eventId: string) =>
  enqueueInTransaction(
    tx,
    analyticsCaptureJob,
    { eventId },
    { orgId, dedupeKey: `analytics.capture:${eventId}` },
  );
