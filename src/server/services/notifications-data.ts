// Alertes (PL-408, §3.2 E12) : fonctions pures. Régression PASS → FAIL, contenu du résumé quotidien selon le rôle,
// jour du résumé. Le contenu d'une alerte ne reprend jamais la charge d'une preuve, seulement son résumé et des
// identifiants (§8.2 : « contenu des notifications, jamais de charge de preuve »).
import type { ControlStatus, IntegrationStatus } from "@/generated/prisma/enums";
import type { OrgRole } from "@/generated/prisma/enums";

const DAY_MS = 86_400_000;
/** « Une preuve dont la validité expire […] déclenche une alerte 14 jours avant » (§3.2 E5). */
export const EXPIRY_NOTICE_DAYS = 14;
/** Lignes au plus par rubrique du résumé ; au-delà, le décompte. */
export const DIGEST_MAX_LINES = 20;
/** Raisons reprises au plus dans l'email de régression. */
export const ALERT_MAX_REASONS = 5;
/** Heure d'envoi du résumé (UTC), après le passage quotidien de 02:17 (vercel.json). */
export const DIGEST_HOUR_UTC = 5;
export const DIGEST_MINUTE_UTC = 47;

export const NOTIFICATION_TYPES = [
  "control.failed",
  "digest.daily",
  "pack.ready",
  "watch.published",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Email immédiat au responsable « quand un contrôle passe de PASS à FAIL » (§3.2 E12). */
export const isRegression = (previous: ControlStatus, next: ControlStatus) =>
  previous === "PASS" && next === "FAIL";

/** Jour du résumé (AAAA-MM-JJ, UTC). */
export const digestDay = (now: Date) => now.toISOString().slice(0, 10);

/** Échéance d'envoi du résumé d'un jour. */
export function digestRunAt(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, DIGEST_HOUR_UTC, DIGEST_MINUTE_UTC));
}

export const expiryWindow = (now: Date) => ({
  from: now,
  to: new Date(now.getTime() + EXPIRY_NOTICE_DAYS * DAY_MS),
});

const FAILING_INTEGRATIONS: ReadonlySet<IntegrationStatus> = new Set([
  "ERROR",
  "REVOKED",
  "SUSPENDED",
]);

export interface DigestFacts {
  expiring: {
    controlInstanceId: string;
    controlKey: string;
    controlOwnerId: string | null;
    systemId: string;
    systemName: string;
    systemOwnerId: string | null;
    evidenceSummary: string;
    validUntil: Date;
  }[];
  integrations: { provider: string; status: IntegrationStatus }[];
  staleClassifications: { systemId: string; systemName: string; systemOwnerId: string | null }[];
}

export interface OrgDigest {
  expiring: {
    controlInstanceId: string;
    controlKey: string;
    systemId: string;
    systemName: string;
    evidenceSummary: string;
    validUntil: string;
  }[];
  integrations: { provider: string; status: IntegrationStatus }[];
  staleClassifications: { systemId: string; systemName: string }[];
}

const sees = (role: OrgRole) => role === "owner" || role === "admin";

/**
 * Ce que le résumé d'un utilisateur reprend pour une organisation : owner et admin voient tout ; un contributeur ou un
 * auditeur voit les preuves des contrôles et les classifications des systèmes dont il est responsable. Les connecteurs
 * en erreur relèvent de l'administration (§3.1 : rôle admin, intégrations). Vide : `null`, aucun email.
 */
export function digestForUser(facts: DigestFacts, userId: string, role: OrgRole): OrgDigest | null {
  const all = sees(role);
  const expiring = facts.expiring
    .filter((e) => all || e.controlOwnerId === userId || e.systemOwnerId === userId)
    .sort(
      (a, b) =>
        a.validUntil.getTime() - b.validUntil.getTime() || a.controlKey.localeCompare(b.controlKey),
    )
    .map((e) => ({
      controlInstanceId: e.controlInstanceId,
      controlKey: e.controlKey,
      systemId: e.systemId,
      systemName: e.systemName,
      evidenceSummary: e.evidenceSummary,
      validUntil: e.validUntil.toISOString(),
    }));
  const integrations = all
    ? facts.integrations.filter((i) => FAILING_INTEGRATIONS.has(i.status))
    : [];
  const staleClassifications = facts.staleClassifications
    .filter((s) => all || s.systemOwnerId === userId)
    .map((s) => ({ systemId: s.systemId, systemName: s.systemName }));
  if (expiring.length + integrations.length + staleClassifications.length === 0) return null;
  return { expiring, integrations, staleClassifications };
}
