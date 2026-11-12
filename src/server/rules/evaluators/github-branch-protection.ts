// AIA-15-01 (`github.branchProtection`) et AIA-15-03 (`github.requiredChecks`), d'après le dernier instantané de
// protection de la branche par défaut de chaque dépôt observé (PL-305, PL-307). Fonctions pures.
// - AIA-15-01 : « la branche par défaut exige au moins une approbation, sans contournement » : branche protégée,
//   approbations requises ≥ minApprovals, règles imposées aux administrateurs, ni poussée forcée ni suppression.
// - AIA-15-03 : « des vérifications automatiques sont obligatoires et réussies avant fusion » : au moins un check
//   requis, imposé aussi aux administrateurs (sans contournement, une fusion ne peut pas passer outre un check en échec).
import { z } from "zod";
import { reason, type EvaluableControl, type EvidenceRecord, type EvaluatorEntry } from "../engine";
import type { Evaluation, EvaluationReason } from "../evaluation";
import { latestBy, missing, numberParam, parsed, result, staleness } from "./common";

const KIND = "github.branch_protection.snapshot";

const snapshot = z.object({
  branch: z.string(),
  defaultBranch: z.boolean(),
  protected: z.boolean(),
  requiredApprovingReviewCount: z.number().int(),
  requiredStatusChecks: z.array(z.string()),
  enforceAdmins: z.boolean(),
  allowForcePushes: z.boolean(),
  allowDeletions: z.boolean(),
});
type Snapshot = z.infer<typeof snapshot>;

function evaluateSnapshots(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
  check: (s: Snapshot, id: string) => EvaluationReason[],
  pass: EvaluationReason,
): Evaluation {
  const latest = latestBy(
    parsed(evidence, KIND, snapshot).filter((s) => s.data.defaultBranch),
    (s) => s.record.resourceId ?? "",
  );
  if (latest.length === 0) {
    return missing(
      "NO_PROTECTION_SNAPSHOT",
      "Aucun instantané de la protection de la branche par défaut.",
      "No snapshot of the default branch protection.",
    );
  }
  const stale = staleness(
    control,
    latest.map((s) => s.record),
    now,
  );
  if (stale) return stale;
  const ids = latest.map((s) => s.record.id);
  const problems = latest.flatMap((s) => check(s.data, s.record.id));
  if (problems.length > 0) return result("FAIL", problems, ids);
  return result("PASS", [{ ...pass, evidenceIds: ids }], ids);
}

export function evaluateBranchProtection(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const minApprovals = numberParam(control, "minApprovals", 1);
  return evaluateSnapshots(
    control,
    evidence,
    now,
    (s, id) => {
      const branch = s.branch;
      if (!s.protected) {
        return [
          reason(
            "BRANCH_UNPROTECTED",
            `La branche ${branch} n'est pas protégée.`,
            `Branch ${branch} is not protected.`,
            [id],
          ),
        ];
      }
      const problems: EvaluationReason[] = [];
      if (s.requiredApprovingReviewCount < minApprovals) {
        problems.push(
          reason(
            "APPROVALS_NOT_REQUIRED",
            `La branche ${branch} exige ${s.requiredApprovingReviewCount} approbation(s), ${minApprovals} attendue(s).`,
            `Branch ${branch} requires ${s.requiredApprovingReviewCount} approval(s); ${minApprovals} expected.`,
            [id],
          ),
        );
      }
      if (!s.enforceAdmins) {
        problems.push(
          reason(
            "ADMIN_BYPASS",
            `Les administrateurs peuvent contourner la protection de ${branch}.`,
            `Administrators can bypass the protection of ${branch}.`,
            [id],
          ),
        );
      }
      if (s.allowForcePushes || s.allowDeletions) {
        problems.push(
          reason(
            "FORCE_PUSH_ALLOWED",
            `La branche ${branch} accepte la poussée forcée ou la suppression.`,
            `Branch ${branch} allows force pushes or deletion.`,
            [id],
          ),
        );
      }
      return problems;
    },
    reason(
      "BRANCH_PROTECTED",
      `Branche par défaut protégée : au moins ${minApprovals} approbation(s) exigée(s), sans contournement.`,
      `Default branch protected: at least ${minApprovals} approval(s) required, with no bypass.`,
    ),
  );
}

export function evaluateRequiredChecks(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  return evaluateSnapshots(
    control,
    evidence,
    now,
    (s, id) => {
      const problems: EvaluationReason[] = [];
      if (!s.protected || s.requiredStatusChecks.length === 0) {
        problems.push(
          reason(
            "NO_REQUIRED_CHECKS",
            `Aucune vérification automatique n'est exigée avant fusion sur ${s.branch}.`,
            `No automated check is required before merging into ${s.branch}.`,
            [id],
          ),
        );
      } else if (!s.enforceAdmins) {
        problems.push(
          reason(
            "ADMIN_BYPASS",
            `Les administrateurs peuvent fusionner sur ${s.branch} malgré un check en échec.`,
            `Administrators can merge into ${s.branch} despite a failing check.`,
            [id],
          ),
        );
      }
      return problems;
    },
    reason(
      "REQUIRED_CHECKS",
      "Des vérifications automatiques sont exigées et doivent réussir avant toute fusion.",
      "Automated checks are required and must pass before any merge.",
    ),
  );
}

export const branchProtectionEvaluator: EvaluatorEntry = {
  version: "github.branchProtection@1",
  evaluate: evaluateBranchProtection,
};

export const requiredChecksEvaluator: EvaluatorEntry = {
  version: "github.requiredChecks@1",
  evaluate: evaluateRequiredChecks,
};
