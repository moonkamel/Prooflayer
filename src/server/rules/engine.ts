// Moteur d'évaluation des contrôles (PL-401, §3.2 E6). `evaluate(definition, evidence[], now)` est pur : aucun accès
// réseau, aucun accès base. Il retient les preuves des types acceptés par le contrôle, puis confie le jugement à
// l'évaluateur désigné par `evaluatorKey`. Six statuts (PASS, FAIL, PARTIAL, STALE, MISSING, NOT_APPLICABLE), raisons
// structurées bilingues. Un évaluateur que son ticket n'a pas encore livré ne produit aucune évaluation.
import type { Evaluation, EvaluationReason } from "./evaluation";
import type { EvaluatorKey } from "./evaluator-keys";

/** Contrôle tel que l'évaluateur le lit (`ControlDefinition`). */
export interface EvaluableControl {
  key: string;
  evaluatorKey: string;
  evidenceKinds: readonly string[];
  /** Durée de validité d'une preuve en jours ; null : sans péremption. */
  freshnessDays: number | null;
  params: Readonly<Record<string, unknown>>;
}

/** Preuve telle que l'évaluateur la lit (`EvidenceItem`), sans la charge brute. */
export interface EvidenceRecord {
  id: string;
  kind: string;
  resourceId: string | null;
  occurredAt: Date;
  capturedAt: Date;
  /** Charge normalisée ; null après effacement. */
  payload: unknown;
  /** Preuve manuelle ou attestation (§4.3.2). */
  declarative: boolean;
  validUntil: Date | null;
  /** Rattachée au contrôle par un utilisateur, et non par une règle. */
  linkedByUser: boolean;
}

export type Evaluator = (
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
) => Evaluation;

export interface EvaluatorEntry {
  /** Version historisée avec chaque évaluation (§3.2 E6), par exemple « document.presentAndFresh@1 ». */
  version: string;
  evaluate: Evaluator;
}

export type EvaluatorRegistry = Partial<Record<EvaluatorKey, EvaluatorEntry>>;

export interface EngineResult {
  evaluation: Evaluation;
  evaluatorVersion: string;
}

/** Évalue un contrôle ; null si son évaluateur n'est pas encore livré. */
export function evaluate(
  definition: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
  registry: EvaluatorRegistry,
): EngineResult | null {
  const entry = registry[definition.evaluatorKey as EvaluatorKey];
  if (!entry) return null;
  const accepted = evidence.filter((e) => definition.evidenceKinds.includes(e.kind));
  return { evaluation: entry.evaluate(definition, accepted, now), evaluatorVersion: entry.version };
}

const DAY_MS = 86_400_000;

/** Raison d'une évaluation, en français et en anglais. */
export const reason = (
  code: string,
  fr: string,
  en: string,
  evidenceIds: string[] = [],
): EvaluationReason => ({ code, message: { fr, en }, evidenceIds });

/** Vrai si la preuve a dépassé sa durée de fraîcheur, ou sa date de validité pour une preuve déclarative. */
export function isStale(
  evidence: EvidenceRecord,
  freshnessDays: number | null,
  now: Date,
): boolean {
  if (evidence.validUntil && evidence.validUntil.getTime() < now.getTime()) return true;
  if (freshnessDays === null) return false;
  return now.getTime() - evidence.occurredAt.getTime() > freshnessDays * DAY_MS;
}

/** Preuves de la plus récente à la plus ancienne (date de la source, puis de capture, puis identifiant). */
export function newestFirst<T extends EvidenceRecord>(evidence: readonly T[]): T[] {
  return [...evidence].sort(
    (a, b) =>
      b.occurredAt.getTime() - a.occurredAt.getTime() ||
      b.capturedAt.getTime() - a.capturedAt.getTime() ||
      b.id.localeCompare(a.id),
  );
}

/** Début d'une fenêtre glissante de `days` jours se terminant à `now`. */
export const windowStart = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);
