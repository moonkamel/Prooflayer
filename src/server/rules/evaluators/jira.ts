// Évaluateurs Jira (PL-404, §12.3), d'après les instantanés `jira.issue.snapshot` des correspondances du système.
// Seul le dernier instantané de chaque ticket compte ; un ticket sorti de la correspondance (`inMapping: false`) n'est
// plus pris en compte. Péremption commune : la capture la plus récente au-delà de `freshnessDays` (synchronisation
// interrompue) → STALE. Fonctions pures.
// - AIA-09-01 (`jira.riskRegisterExists`) : le registre des risques compte au moins un ticket.
// - AIA-09-02 (`jira.riskRegisterReviewed`) : activité sur un ticket de risque depuis moins de `reviewDays` jours.
// - AIA-09-03 (`jira.riskMitigationLinked`) : chaque risque élevé (priorité Highest ou High) a une mesure liée et un
//   risque résiduel accepté par un responsable nommé (champ d'acceptation configuré sur la correspondance).
// - AIA-20-01 (`jira.incidentCorrectiveAction`) : chaque incident clos est lié à une action corrective.
// - AIA-72-02 (`jira.monitoringReviewed`) : une revue de surveillance terminée depuis moins de `reviewDays` jours.
// - AIA-73-01 (`jira.seriousIncidentNotified`) : chaque incident grave (étiquette `serious-incident`) est notifié
//   (passage à un statut « Notifié » / « Notified ») dans le délai de l'Art. 73 : `defaultDays` (15), `deathDays` (10,
//   étiquette `incident-death`), `criticalInfrastructureDays` (2, étiquettes `incident-critical-infrastructure` ou
//   `incident-widespread`), compté depuis la création du ticket.
import { z } from "zod";
import { reason, type EvaluableControl, type EvidenceRecord, type EvaluatorEntry } from "../engine";
import type { Evaluation, EvaluationReason } from "../evaluation";
import { detailed, latestBy, missing, numberParam, parsed, result, staleness } from "./common";

const DAY_MS = 86_400_000;

const snapshot = z.object({
  issueId: z.string(),
  key: z.string(),
  purpose: z.string(),
  inMapping: z.boolean(),
  statusCategory: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  labels: z.array(z.string()).optional().default([]),
  resolutionDate: z.string().nullable().optional(),
  created: z.string().optional(),
  updated: z.string().optional(),
  links: z
    .array(z.object({ type: z.string(), key: z.string() }))
    .optional()
    .default([]),
  statusHistory: z
    .array(z.object({ at: z.string(), from: z.string().nullable(), to: z.string().nullable() }))
    .optional()
    .default([]),
  acceptedByAccountId: z.string().nullable().optional(),
});
type Issue = { record: EvidenceRecord; data: z.infer<typeof snapshot> };

/** Dernier instantané de chaque ticket de la finalité ; `all` garde aussi les tickets sortis. */
function issuesOf(evidence: readonly EvidenceRecord[], purpose: string) {
  const all = latestBy(
    parsed(evidence, "jira.issue.snapshot", snapshot).filter((s) => s.data.purpose === purpose),
    (s) => s.data.issueId,
  );
  return { all, current: all.filter((s) => s.data.inMapping) };
}

const ids = (issues: readonly Issue[]) => issues.map((i) => i.record.id);
const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY_MS);
const isDone = (i: Issue) => i.data.statusCategory === "done";
const HIGH_PRIORITIES = new Set(["Highest", "High"]);

/** Absent ou périmé : commun à tous les évaluateurs Jira. */
function precheck(
  control: EvaluableControl,
  all: readonly Issue[],
  now: Date,
  absent: [string, string, string],
): Evaluation | null {
  if (all.length === 0) return missing(...absent);
  return staleness(
    control,
    all.map((i) => i.record),
    now,
  );
}

export function evaluateRiskRegisterExists(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const { all, current } = issuesOf(evidence, "risks");
  const early = precheck(control, all, now, [
    "NO_RISK_REGISTER",
    "Aucun ticket capturé dans la correspondance « registre des risques ».",
    "No issue captured in the “risk register” mapping.",
  ]);
  if (early) return early;
  if (current.length === 0) {
    return result(
      "FAIL",
      [
        reason(
          "EMPTY_RISK_REGISTER",
          "Le registre des risques ne compte plus aucun ticket.",
          "The risk register no longer holds any issue.",
          ids(all),
        ),
      ],
      ids(all),
    );
  }
  return result(
    "PASS",
    [
      reason(
        "RISK_REGISTER_PRESENT",
        `Registre des risques : ${current.length} risque(s) identifié(s) ; leur portée (santé, sécurité, droits fondamentaux) reste appréciée par un humain.`,
        `Risk register: ${current.length} risk(s) identified; their scope (health, safety, fundamental rights) is assessed by a person.`,
        ids(current),
      ),
    ],
    ids(current),
  );
}

export function evaluateRiskRegisterReviewed(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const reviewDays = numberParam(control, "reviewDays", 90);
  const { all, current } = issuesOf(evidence, "risks");
  const early = precheck(control, all, now, [
    "NO_RISK_REGISTER",
    "Aucun ticket capturé dans la correspondance « registre des risques ».",
    "No issue captured in the “risk register” mapping.",
  ]);
  if (early) return early;
  const activity = current
    .map((i) => ({ issue: i, at: new Date(i.data.updated ?? 0) }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const latest = activity[0];
  if (!latest) {
    return result(
      "FAIL",
      [
        reason(
          "EMPTY_RISK_REGISTER",
          "Le registre des risques est vide.",
          "The risk register is empty.",
          ids(all),
        ),
      ],
      ids(all),
    );
  }
  const age = daysBetween(latest.at, now);
  if (age > reviewDays) {
    return result(
      "FAIL",
      [
        reason(
          "RISK_REGISTER_NOT_REVIEWED",
          `Dernière activité sur le registre des risques il y a ${age} jours (au plus ${reviewDays}).`,
          `Last activity on the risk register ${age} days ago (at most ${reviewDays}).`,
          [latest.issue.record.id],
        ),
      ],
      ids(current),
    );
  }
  return result(
    "PASS",
    [
      reason(
        "RISK_REGISTER_REVIEWED",
        `Registre des risques revu il y a ${age} jours.`,
        `Risk register reviewed ${age} days ago.`,
        [latest.issue.record.id],
      ),
    ],
    ids(current),
  );
}

export function evaluateRiskMitigationLinked(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const { all, current } = issuesOf(evidence, "risks");
  const early = precheck(control, all, now, [
    "NO_RISK_REGISTER",
    "Aucun ticket capturé dans la correspondance « registre des risques ».",
    "No issue captured in the “risk register” mapping.",
  ]);
  if (early) return early;
  const high = current.filter((i) => HIGH_PRIORITIES.has(i.data.priority ?? ""));
  if (high.length === 0) {
    return result(
      "PASS",
      [
        reason(
          "NO_HIGH_RISK",
          "Aucun risque élevé (priorité Highest ou High) dans le registre.",
          "No high risk (Highest or High priority) in the register.",
          ids(current),
        ),
      ],
      ids(current),
    );
  }
  const problems: EvaluationReason[] = [];
  for (const risk of high) {
    if (risk.data.links.length === 0) {
      problems.push(
        reason(
          "NO_MITIGATION",
          `Risque élevé ${risk.data.key} sans mesure liée.`,
          `High risk ${risk.data.key} has no linked measure.`,
          [risk.record.id],
        ),
      );
    }
    if (risk.data.acceptedByAccountId === null) {
      problems.push(
        reason(
          "NO_RESIDUAL_ACCEPTANCE",
          `Risque élevé ${risk.data.key} sans acceptation nommée du risque résiduel.`,
          `High risk ${risk.data.key} has no named acceptance of the residual risk.`,
          [risk.record.id],
        ),
      );
    }
  }
  if (problems.length > 0) {
    return result(
      "FAIL",
      detailed(problems, {
        code: "HIGH_RISK_ISSUES",
        fr: (n) => `${n} manquement(s) sur ${high.length} risque(s) élevé(s).`,
        en: (n) => `${n} gap(s) across ${high.length} high risk(s).`,
      }),
      ids(high),
    );
  }
  // Mesures liées partout, mais aucun champ d'acceptation configuré : l'acceptation n'est pas vérifiable.
  if (high.every((i) => i.data.acceptedByAccountId === undefined)) {
    return result(
      "PARTIAL",
      [
        reason(
          "ACCEPTANCE_NOT_CONFIGURED",
          "Chaque risque élevé a une mesure liée ; l'acceptation du risque résiduel n'est pas vérifiable (champ d'acceptation non configuré).",
          "Each high risk has a linked measure; residual risk acceptance cannot be checked (no acceptance field configured).",
          ids(high),
        ),
      ],
      ids(high),
    );
  }
  return result(
    "PASS",
    [
      reason(
        "HIGH_RISKS_MITIGATED",
        `${high.length} risque(s) élevé(s), chacun avec une mesure liée et un risque résiduel accepté par un responsable nommé.`,
        `${high.length} high risk(s), each with a linked measure and a residual risk accepted by a named owner.`,
        ids(high),
      ),
    ],
    ids(high),
  );
}

export function evaluateIncidentCorrectiveAction(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const { all, current } = issuesOf(evidence, "incidents");
  const early = precheck(control, all, now, [
    "NO_INCIDENT_MAPPING",
    "Aucun ticket capturé dans la correspondance « incidents IA ».",
    "No issue captured in the “AI incidents” mapping.",
  ]);
  if (early) return early;
  const closed = current.filter(isDone);
  const faulty = closed
    .filter((i) => i.data.links.length === 0)
    .map((i) =>
      reason(
        "CLOSED_WITHOUT_ACTION",
        `Incident ${i.data.key} clos sans action corrective liée.`,
        `Incident ${i.data.key} closed without a linked corrective action.`,
        [i.record.id],
      ),
    );
  if (faulty.length > 0) {
    return result(
      "FAIL",
      detailed(faulty, {
        code: "CLOSED_WITHOUT_ACTION_COUNT",
        fr: (n) => `${n} incident(s) clos sur ${closed.length} sans action corrective.`,
        en: (n) => `${n} of ${closed.length} closed incident(s) without a corrective action.`,
      }),
      ids(closed),
    );
  }
  return result(
    "PASS",
    [
      closed.length === 0
        ? reason(
            "NO_CLOSED_INCIDENT",
            "Aucun incident clos à vérifier.",
            "No closed incident to check.",
            ids(current),
          )
        : reason(
            "INCIDENTS_ACTIONED",
            `Chacun des ${closed.length} incident(s) clos est lié à une action corrective.`,
            `Each of the ${closed.length} closed incident(s) is linked to a corrective action.`,
            ids(closed),
          ),
    ],
    ids(current),
  );
}

export function evaluateMonitoringReviewed(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const reviewDays = numberParam(control, "reviewDays", 92);
  const { all, current } = issuesOf(evidence, "monitoring_reviews");
  const early = precheck(control, all, now, [
    "NO_MONITORING_REVIEW",
    "Aucun ticket capturé dans la correspondance « revues de surveillance ».",
    "No issue captured in the “monitoring reviews” mapping.",
  ]);
  if (early) return early;
  const completed = current
    .filter(isDone)
    .map((i) => ({ issue: i, at: new Date(i.data.resolutionDate ?? i.data.updated ?? 0) }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const latest = completed[0];
  if (!latest) {
    return result(
      "FAIL",
      [
        reason(
          "NO_COMPLETED_REVIEW",
          "Aucune revue de surveillance terminée.",
          "No completed monitoring review.",
          ids(current),
        ),
      ],
      ids(current),
    );
  }
  const age = daysBetween(latest.at, now);
  if (age > reviewDays) {
    return result(
      "FAIL",
      [
        reason(
          "REVIEW_OVERDUE",
          `Dernière revue de surveillance terminée il y a ${age} jours (au plus ${reviewDays}).`,
          `Last monitoring review completed ${age} days ago (at most ${reviewDays}).`,
          [latest.issue.record.id],
        ),
      ],
      [latest.issue.record.id],
    );
  }
  return result(
    "PASS",
    [
      reason(
        "MONITORING_REVIEWED",
        `Revue de surveillance terminée il y a ${age} jours.`,
        `Monitoring review completed ${age} days ago.`,
        [latest.issue.record.id],
      ),
    ],
    [latest.issue.record.id],
  );
}

const NOTIFIED_STATUS = /^(notifié|notifiée|notified)$/iu;

/** Délai de notification (jours) d'un incident grave d'après ses étiquettes (Art. 73(2) à (4)). */
function deadlineDays(control: EvaluableControl, labels: string[]) {
  const days = [numberParam(control, "defaultDays", 15)];
  if (labels.includes("incident-death")) days.push(numberParam(control, "deathDays", 10));
  if (
    labels.includes("incident-critical-infrastructure") ||
    labels.includes("incident-widespread")
  ) {
    days.push(numberParam(control, "criticalInfrastructureDays", 2));
  }
  return Math.min(...days);
}

export function evaluateSeriousIncidentNotified(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const { all, current } = issuesOf(evidence, "incidents");
  const early = precheck(control, all, now, [
    "NO_INCIDENT_MAPPING",
    "Aucun ticket capturé dans la correspondance « incidents IA ».",
    "No issue captured in the “AI incidents” mapping.",
  ]);
  if (early) return early;
  const serious = current.filter((i) => i.data.labels.includes("serious-incident"));
  if (serious.length === 0) {
    return result(
      "PASS",
      [
        reason(
          "NO_SERIOUS_INCIDENT",
          "Aucun incident grave (étiquette serious-incident) dans la correspondance.",
          "No serious incident (serious-incident label) in the mapping.",
          ids(current),
        ),
      ],
      ids(current),
    );
  }
  const late: EvaluationReason[] = [];
  const pending: EvaluationReason[] = [];
  for (const incident of serious) {
    const days = deadlineDays(control, incident.data.labels);
    const aware = new Date(incident.data.created ?? 0);
    const deadline = new Date(aware.getTime() + days * DAY_MS);
    const notified = incident.data.statusHistory.find((h) => NOTIFIED_STATUS.test(h.to ?? ""));
    const key = incident.data.key;
    if (notified) {
      const at = new Date(notified.at);
      if (at > deadline) {
        late.push(
          reason(
            "NOTIFIED_LATE",
            `Incident grave ${key} notifié après ${daysBetween(aware, at)} jours (délai : ${days}).`,
            `Serious incident ${key} notified after ${daysBetween(aware, at)} days (deadline: ${days}).`,
            [incident.record.id],
          ),
        );
      }
    } else if (now > deadline) {
      late.push(
        reason(
          "NOT_NOTIFIED",
          `Incident grave ${key} non notifié, délai de ${days} jours dépassé.`,
          `Serious incident ${key} not notified; ${days}-day deadline exceeded.`,
          [incident.record.id],
        ),
      );
    } else {
      pending.push(
        reason(
          "NOTIFICATION_PENDING",
          `Incident grave ${key} à notifier avant le ${deadline.toISOString().slice(0, 10)}.`,
          `Serious incident ${key} to be notified by ${deadline.toISOString().slice(0, 10)}.`,
          [incident.record.id],
        ),
      );
    }
  }
  if (late.length > 0) {
    return result(
      "FAIL",
      detailed(late, {
        code: "LATE_NOTIFICATION_COUNT",
        fr: (n) => `${n} incident(s) grave(s) sur ${serious.length} non notifié(s) dans le délai.`,
        en: (n) => `${n} of ${serious.length} serious incident(s) not notified in time.`,
      }),
      ids(serious),
    );
  }
  if (pending.length > 0) return result("PARTIAL", pending, ids(serious));
  return result(
    "PASS",
    [
      reason(
        "SERIOUS_INCIDENTS_NOTIFIED",
        `Chacun des ${serious.length} incident(s) grave(s) a été notifié dans le délai.`,
        `Each of the ${serious.length} serious incident(s) was notified in time.`,
        ids(serious),
      ),
    ],
    ids(serious),
  );
}

const entry = (key: string, evaluate: EvaluatorEntry["evaluate"]): EvaluatorEntry => ({
  version: `${key}@1`,
  evaluate,
});

export const JIRA_EVALUATORS = {
  "jira.riskRegisterExists": entry("jira.riskRegisterExists", evaluateRiskRegisterExists),
  "jira.riskRegisterReviewed": entry("jira.riskRegisterReviewed", evaluateRiskRegisterReviewed),
  "jira.riskMitigationLinked": entry("jira.riskMitigationLinked", evaluateRiskMitigationLinked),
  "jira.incidentCorrectiveAction": entry(
    "jira.incidentCorrectiveAction",
    evaluateIncidentCorrectiveAction,
  ),
  "jira.monitoringReviewed": entry("jira.monitoringReviewed", evaluateMonitoringReviewed),
  "jira.seriousIncidentNotified": entry(
    "jira.seriousIncidentNotified",
    evaluateSeriousIncidentNotified,
  ),
} as const;
