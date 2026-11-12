// Détail d'un contrôle (PL-407, écran D du §5.3) : fonctions pures. Frise d'historique sur 12 semaines, preuves
// fautives en tête, preuve attendue et convention à suivre quand le contrôle est sans preuve, lien sûr vers la source.
import type { ControlStatus } from "@/generated/prisma/enums";
import type { EvaluationReason } from "@/server/rules/evaluation";
import { connectorOf } from "./dashboard-data";

const DAY_MS = 86_400_000;
export const HISTORY_WEEKS = 12;
/** Justification de non-applicabilité : au moins une phrase (§5.3 écran D « justification obligatoire »). */
export const NA_JUSTIFICATION_MIN = 20;
export const NA_JUSTIFICATION_MAX = 2000;
export const COMMENT_MAX = 2000;
export const EVIDENCE_PAGE_SIZE = 20;

/** Statuts pour lesquels les preuves citées par les raisons sont fautives et passent en tête. */
const FAULTY_STATUSES: ReadonlySet<ControlStatus> = new Set(["FAIL", "PARTIAL", "STALE"]);

/** Lundi 00:00 UTC de la semaine d'une date. */
export function weekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - offset * DAY_MS);
}

export interface HistoryPoint {
  week: string; // AAAA-MM-JJ, lundi de la semaine
  status: ControlStatus | null; // dernier statut évalué de la semaine, null sans évaluation
}

/**
 * Frise « Historique : ✔✔✔✖… (12 semaines) » : pour chaque semaine (lundi UTC), le statut de la dernière évaluation
 * de la semaine. La semaine courante est la dernière de la frise.
 */
export function weeklyHistory(
  evaluations: readonly { status: ControlStatus; evaluatedAt: Date }[],
  now: Date,
  weeks = HISTORY_WEEKS,
): HistoryPoint[] {
  const current = weekStart(now).getTime();
  const points: HistoryPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = current - i * 7 * DAY_MS;
    const end = start + 7 * DAY_MS;
    let latest: { status: ControlStatus; at: number } | null = null;
    for (const e of evaluations) {
      const at = e.evaluatedAt.getTime();
      if (at >= start && at < end && at <= now.getTime() && (!latest || at >= latest.at)) {
        latest = { status: e.status, at };
      }
    }
    points.push({
      week: new Date(start).toISOString().slice(0, 10),
      status: latest?.status ?? null,
    });
  }
  return points;
}

/** Identifiants des preuves citées par les raisons de la dernière évaluation, quand elle n'est pas un succès. */
export function faultyEvidenceIds(
  latest: { status: ControlStatus; reasons: readonly EvaluationReason[] } | null,
): Set<string> {
  if (!latest || !FAULTY_STATUSES.has(latest.status)) return new Set();
  return new Set(latest.reasons.flatMap((r) => r.evidenceIds));
}

/** Preuves fautives en tête, puis les plus récentes ; l'ordre est stable (identifiant en dernier recours). */
export function orderEvidence<T extends { id: string; occurredAt: Date }>(
  items: readonly T[],
  faulty: ReadonlySet<string>,
): (T & { faulty: boolean })[] {
  return items
    .map((item) => ({ ...item, faulty: faulty.has(item.id) }))
    .sort(
      (a, b) =>
        Number(b.faulty) - Number(a.faulty) ||
        b.occurredAt.getTime() - a.occurredAt.getTime() ||
        a.id.localeCompare(b.id),
    );
}

/** Lien vers la source : https uniquement (une adresse fournie par une source tierce n'est jamais un `javascript:`). */
export function safeSourceUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Finalité de correspondance Jira lue par chaque évaluateur Jira (PL-404). */
const JIRA_PURPOSE: Record<string, string> = {
  "jira.riskRegisterExists": "risks",
  "jira.riskRegisterReviewed": "risks",
  "jira.riskMitigationLinked": "risks",
  "jira.incidentCorrectiveAction": "incidents",
  "jira.seriousIncidentNotified": "incidents",
  "jira.monitoringReviewed": "monitoring_reviews",
};

export interface ExpectedEvidence {
  kinds: string[];
  /** Chemin attendu dans le dépôt (convention `docs/ai/…`), si le contrôle en fixe un. */
  path: string | null;
  freshnessDays: number | null;
  connector: "GITHUB" | "JIRA" | null;
  /** Finalité de la correspondance Jira à déclarer dans l'onglet Sources. */
  jiraPurpose: string | null;
  /** Le contrôle accepte une preuve déposée ou une attestation. */
  manual: boolean;
}

/** Contrôle sans preuve : ce qui est attendu et la convention à suivre (§5.3 écran D, état « sans preuve »). */
export function expectedEvidence(definition: {
  evidenceKinds: readonly string[];
  evaluatorKey: string;
  freshnessDays: number | null;
  params: unknown;
}): ExpectedEvidence {
  const params = (definition.params ?? {}) as Record<string, unknown>;
  return {
    kinds: [...definition.evidenceKinds],
    path: typeof params.path === "string" ? params.path : null,
    freshnessDays: definition.freshnessDays,
    connector:
      connectorOf(definition.evaluatorKey) ??
      (definition.evidenceKinds.some((k) => k.startsWith("github."))
        ? "GITHUB"
        : definition.evidenceKinds.some((k) => k.startsWith("jira."))
          ? "JIRA"
          : null),
    jiraPurpose: JIRA_PURPOSE[definition.evaluatorKey] ?? null,
    manual: definition.evidenceKinds.some((k) => k.startsWith("manual.")),
  };
}

/** Raisons d'une évaluation relues sans confiance (colonne JSON) : seules les entrées bien formées sont gardées. */
export function parseReasons(value: unknown): EvaluationReason[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const { code, message, evidenceIds } = r as Record<string, unknown>;
    const m = message as Record<string, unknown> | undefined;
    if (typeof code !== "string" || typeof m?.fr !== "string" || typeof m?.en !== "string")
      return [];
    return [
      {
        code,
        message: { fr: m.fr, en: m.en },
        evidenceIds: Array.isArray(evidenceIds)
          ? evidenceIds.filter((id): id is string => typeof id === "string")
          : [],
      },
    ];
  });
}
