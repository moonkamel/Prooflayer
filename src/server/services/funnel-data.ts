// PL-608 — Entonnoir d'activation (§1.4, « mesurer l'hypothèse de valeur »), fonctions pures.
// Seuils du §1.4 : délai inscription → première preuve capturée < 15 min (médiane) ; part des contrôles applicables
// évalués automatiquement ≥ 40 %. ProofLayer mesure des organisations, jamais des personnes (§4.7).
import { connectorOf } from "./dashboard-data";

export const FUNNEL_EVENTS = [
  "signup",
  "classification_signed",
  "connector_linked",
  "first_evidence",
  "first_pack",
] as const;
export type FunnelEventName = (typeof FUNNEL_EVENTS)[number];

export const THRESHOLDS = { firstEvidenceMinutes: 15, automatedShare: 0.4 } as const;

export interface OrgFunnel {
  steps: Record<FunnelEventName, Date | null>;
  /** Minutes entre l'inscription et la première preuve capturée ; null si l'une manque. */
  firstEvidenceMinutes: number | null;
  automated: { evaluated: number; applicable: number; share: number | null };
}

export function funnelSteps(events: readonly { name: string; occurredAt: Date }[]) {
  const steps = Object.fromEntries(FUNNEL_EVENTS.map((n) => [n, null])) as Record<
    FunnelEventName,
    Date | null
  >;
  for (const e of events) {
    if (!(FUNNEL_EVENTS as readonly string[]).includes(e.name)) continue;
    const name = e.name as FunnelEventName;
    if (!steps[name] || e.occurredAt < steps[name]!) steps[name] = e.occurredAt;
  }
  return steps;
}

/**
 * Contrôles applicables évalués automatiquement : évaluateur d'un connecteur (GitHub, Jira), dernière évaluation
 * portant un statut tiré de preuves (PASS, FAIL, PARTIAL, STALE ; MISSING = rien de capturé). Les contrôles manuels,
 * semi-manuels déclaratifs et internes comptent au dénominateur seulement.
 */
export function automatedShare(
  instances: readonly { notApplicable: boolean; status: string; evaluatorKey: string | null }[],
) {
  const applicable = instances.filter((i) => !i.notApplicable && i.status !== "NOT_APPLICABLE");
  const evaluated = applicable.filter(
    (i) => i.evaluatorKey && connectorOf(i.evaluatorKey) && i.status !== "MISSING",
  ).length;
  return {
    evaluated,
    applicable: applicable.length,
    share: applicable.length ? evaluated / applicable.length : null,
  };
}

export function orgFunnel(
  events: readonly { name: string; occurredAt: Date }[],
  instances: Parameters<typeof automatedShare>[0],
): OrgFunnel {
  const steps = funnelSteps(events);
  const firstEvidenceMinutes =
    steps.signup && steps.first_evidence
      ? Math.max(0, (steps.first_evidence.getTime() - steps.signup.getTime()) / 60_000)
      : null;
  return { steps, firstEvidenceMinutes, automated: automatedShare(instances) };
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Synthèse sur un ensemble d'organisations (design partners) : conversion par étape, médianes, seuils du §1.4. */
export function funnelSummary(orgs: readonly OrgFunnel[]) {
  const reached = Object.fromEntries(
    FUNNEL_EVENTS.map((n) => [n, orgs.filter((o) => o.steps[n]).length]),
  ) as Record<FunnelEventName, number>;
  const delays = orgs.flatMap((o) =>
    o.firstEvidenceMinutes === null ? [] : [o.firstEvidenceMinutes],
  );
  const shares = orgs.flatMap((o) => (o.automated.share === null ? [] : [o.automated.share]));
  const medianDelay = median(delays);
  const medianShare = median(shares);
  return {
    organizations: orgs.length,
    reached,
    medianFirstEvidenceMinutes: medianDelay,
    medianAutomatedShare: medianShare,
    thresholds: {
      firstEvidence: medianDelay === null ? null : medianDelay < THRESHOLDS.firstEvidenceMinutes,
      automatedShare: medianShare === null ? null : medianShare >= THRESHOLDS.automatedShare,
    },
  };
}
