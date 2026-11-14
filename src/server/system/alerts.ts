// Alertes d'exploitation (PL-502) : incident à traiter par l'équipe ProofLayer, pas par le client. Envoyées à Sentry
// (inactif sans DSN) et au journal, avec un code et des détails sans donnée client (décomptes, dates, codes d'erreur).
import * as Sentry from "@sentry/nextjs";

export type OperationalAlert =
  | "seal.anchorOverdue"
  | "seal.tsaNotConfigured"
  | "seal.integrityFailure"
  | "billing.orgMissing"
  | "billing.unknownPrice";

export function raiseOperationalAlert(
  code: OperationalAlert,
  details: Record<string, string | number | boolean | null>,
): void {
  console.error(JSON.stringify({ alert: code, ...details }));
  Sentry.captureMessage(code, { level: "error", tags: { alert: code }, extra: details });
}
