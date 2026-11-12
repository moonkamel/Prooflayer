// Aides communes aux évaluateurs (PL-402). Fonctions pures.
import type { z } from "zod";
import type { ControlStatus } from "@/generated/prisma/enums";
import type { Evaluation, EvaluationReason } from "../evaluation";
import {
  isStale,
  newestFirst,
  reason,
  type EvaluableControl,
  type EvidenceRecord,
} from "../engine";

/** Au plus 20 raisons détaillées par évaluation (prompt-type de PL-402) ; le décompte total est donné à part. */
export const MAX_DETAILED_REASONS = 20;

export const result = (
  status: ControlStatus,
  reasons: EvaluationReason[],
  evidenceIds: string[],
): Evaluation => ({ status, reasons, evidenceIds: [...new Set(evidenceIds)] });

export const missing = (code: string, fr: string, en: string): Evaluation =>
  result("MISSING", [reason(code, fr, en)], []);

/** Preuves dont la charge est valide pour le schéma, avec la charge typée. */
export function parsed<T>(
  evidence: readonly EvidenceRecord[],
  kind: string,
  schema: z.ZodType<T>,
): { record: EvidenceRecord; data: T }[] {
  return evidence.flatMap((record) => {
    if (record.kind !== kind) return [];
    const r = schema.safeParse(record.payload);
    return r.success ? [{ record, data: r.data }] : [];
  });
}

/** Dernier élément par clé (ressource, chemin…), du plus récent au plus ancien. */
export function latestBy<T extends { record: EvidenceRecord }>(
  items: readonly T[],
  key: (item: T) => string,
): T[] {
  const byRecord = new Map(items.map((i) => [i.record, i]));
  const seen = new Map<string, T>();
  for (const record of newestFirst([...byRecord.keys()])) {
    const item = byRecord.get(record)!;
    const k = key(item);
    if (!seen.has(k)) seen.set(k, item);
  }
  return [...seen.values()];
}

/**
 * Péremption commune : si le contrôle fixe une durée de fraîcheur et que la preuve la plus récente la dépasse, STALE
 * (prompt-type de PL-402). Sans durée de fraîcheur, null.
 */
export function staleness(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation | null {
  if (control.freshnessDays === null || evidence.length === 0) return null;
  const [latest] = newestFirst(evidence);
  if (!isStale(latest!, control.freshnessDays, now)) return null;
  return result(
    "STALE",
    [
      reason(
        "EVIDENCE_STALE",
        `La preuve la plus récente date de plus de ${control.freshnessDays} jours.`,
        `The most recent evidence is more than ${control.freshnessDays} days old.`,
        [latest!.id],
      ),
    ],
    [latest!.id],
  );
}

/** Raisons détaillées limitées, suivies du décompte total si la liste est tronquée. */
export function detailed(
  reasons: EvaluationReason[],
  total: { code: string; fr: (n: number) => string; en: (n: number) => string },
): EvaluationReason[] {
  return [
    ...reasons.slice(0, MAX_DETAILED_REASONS),
    reason(total.code, total.fr(reasons.length), total.en(reasons.length)),
  ];
}

export const numberParam = (control: EvaluableControl, name: string, fallback: number) =>
  typeof control.params[name] === "number" ? (control.params[name] as number) : fallback;
