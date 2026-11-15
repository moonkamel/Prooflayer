// PL-610 — Design partners (§7.5) et relevé des quatre métriques du §1.4 par partenaire, fonctions pures.
//   1. délai inscription → première preuve capturée (< 15 min, médiane) ;
//   2. part des contrôles applicables évalués automatiquement (≥ 40 %) ;
//   3. pack transmis à un tiers réel : client, investisseur, auditeur (≥ 3 partenaires sur 5) ;
//   4. converti en payant (≥ 3 sur 5).
// Règle de remplacement : GitHub non connecté deux semaines après l'ouverture de l'accès.
import { funnelSummary, type OrgFunnel } from "./funnel-data";

export const SEGMENTS = ["hr_tech", "fintech", "exemption"] as const;
export type Segment = (typeof SEGMENTS)[number];
export const PACK_AUDIENCES = ["client", "investor", "auditor"] as const;
export type PackAudience = (typeof PACK_AUDIENCES)[number];

/** §7.5 : 12 semaines de pilote gratuit ; remplacement sans GitHub sous 2 semaines ; 3 réussites sur 5 visées. */
export const PILOT_DAYS = 84;
export const REPLACE_AFTER_DAYS = 14;
export const SUCCESS_SHARE = 3 / 5;

const DAY_MS = 86_400_000;

export interface PartnerFacts {
  orgId: string;
  name: string;
  segment: Segment;
  pilotStartedAt: Date;
  sessionAt: Date | null;
  packSharedAt: Date | null;
  packAudience: PackAudience | null;
  replacedAt: Date | null;
  githubConnectedAt: Date | null;
  paying: boolean;
  funnel: OrgFunnel;
}

export function partnerStatus(p: PartnerFacts, now: Date) {
  const pilotEndsAt = new Date(p.pilotStartedAt.getTime() + PILOT_DAYS * DAY_MS);
  const replaceDue =
    !p.replacedAt &&
    !p.githubConnectedAt &&
    now.getTime() - p.pilotStartedAt.getTime() > REPLACE_AFTER_DAYS * DAY_MS;
  return {
    orgId: p.orgId,
    name: p.name,
    segment: p.segment,
    pilotEndsAt,
    sessionDone: p.sessionAt !== null,
    metrics: {
      firstEvidenceMinutes: p.funnel.firstEvidenceMinutes,
      automatedShare: p.funnel.automated.share,
      packShared: p.packSharedAt ? p.packAudience : null,
      paying: p.paying,
    },
    replaceDue,
    replaced: p.replacedAt !== null,
  };
}

/** Cohorte active (partenaires non remplacés) : médianes et seuils des quatre métriques. */
export function cohortReport(partners: readonly PartnerFacts[], now: Date) {
  const active = partners.filter((p) => !p.replacedAt);
  const funnel = funnelSummary(active.map((p) => p.funnel));
  const shared = active.filter((p) => p.packSharedAt).length;
  const paying = active.filter((p) => p.paying).length;
  const enough = (n: number) => (active.length ? n / active.length >= SUCCESS_SHARE : null);
  return {
    partners: partners.map((p) => partnerStatus(p, now)),
    cohort: {
      active: active.length,
      sessionsDone: active.filter((p) => p.sessionAt).length,
      segments: Object.fromEntries(
        SEGMENTS.map((s) => [s, active.filter((p) => p.segment === s).length]),
      ),
      medianFirstEvidenceMinutes: funnel.medianFirstEvidenceMinutes,
      medianAutomatedShare: funnel.medianAutomatedShare,
      packShared: shared,
      paying,
      thresholds: {
        firstEvidence: funnel.thresholds.firstEvidence,
        automatedShare: funnel.thresholds.automatedShare,
        packShared: enough(shared),
        paying: enough(paying),
      },
    },
  };
}
