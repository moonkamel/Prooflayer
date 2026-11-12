// Contrôles portant sur chaque release publiée (hors préversion), par dépôt. Fonctions pures.
// - AIA-09-04 (`github.evalWorkflowOnRelease`) : un workflow d'évaluation (nom ou chemin contenant « eval ») a réussi
//   sur le commit de la release.
// - AIA-15-04 (`github.regressionTestsOnRelease`) : les workflows exécutés sur le tag ont réussi, au moins un.
// - AIA-11-02 (`github.releaseReferencesDocs`) : la release référence une version de la documentation : un fichier
//   présent sous le chemin `path` (`docs/ai/`) capturé sur le tag, ou sur le dépôt au plus tard à la publication.
// Une exécution est rattachée à une release si elle porte sur son tag ou sur son commit cible ; pour chaque workflow,
// seule la dernière tentative compte.
import { z } from "zod";
import { reason, type EvaluableControl, type EvidenceRecord, type EvaluatorEntry } from "../engine";
import type { Evaluation, EvaluationReason } from "../evaluation";
import { detailed, missing, parsed, result, staleness } from "./common";

const release = z.object({
  tagName: z.string(),
  targetCommitish: z.string(),
  prerelease: z.boolean(),
  publishedAt: z.string().datetime(),
});
const run = z.object({
  runId: z.number(),
  runAttempt: z.number().int(),
  workflowName: z.string().nullable(),
  workflowPath: z.string(),
  headBranch: z.string().nullable(),
  headSha: z.string(),
  conclusion: z.string().nullable(),
});
const file = z.object({
  path: z.string(),
  ref: z.string(),
  present: z.boolean(),
  takenAt: z.string().datetime(),
});

type Release = { record: EvidenceRecord; data: z.infer<typeof release> };
type Run = { record: EvidenceRecord; data: z.infer<typeof run> };

const FAILING = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
]);
const isEval = (r: Run) => /eval/iu.test(`${r.data.workflowName ?? ""} ${r.data.workflowPath}`);

function releasesOf(evidence: readonly EvidenceRecord[]): Release[] {
  return parsed(evidence, "github.release.published", release).filter((r) => !r.data.prerelease);
}

/** Dernière tentative de chaque workflow exécuté sur la release. */
function runsFor(rel: Release, runs: readonly Run[]): Run[] {
  const latest = new Map<string, Run>();
  for (const r of runs) {
    if (r.record.resourceId !== rel.record.resourceId) continue;
    const onRelease =
      r.data.headBranch === rel.data.tagName || r.data.headSha === rel.data.targetCommitish;
    if (!onRelease) continue;
    const current = latest.get(r.data.workflowPath);
    if (
      !current ||
      r.data.runId > current.data.runId ||
      (r.data.runId === current.data.runId && r.data.runAttempt > current.data.runAttempt)
    ) {
      latest.set(r.data.workflowPath, r);
    }
  }
  return [...latest.values()];
}

function perRelease(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
  judge: (rel: Release) => { ok: boolean; reason?: EvaluationReason; evidenceIds: string[] },
  texts: {
    pass: (n: number) => [string, string];
    total: (n: number, of: number) => [string, string];
  },
): Evaluation {
  const releases = releasesOf(evidence);
  if (releases.length === 0) {
    return missing(
      "NO_RELEASE",
      "Aucune release publiée n'a été capturée.",
      "No published release has been captured.",
    );
  }
  const stale = staleness(
    control,
    releases.map((r) => r.record),
    now,
  );
  if (stale) return stale;
  const ids: string[] = [];
  const faulty: EvaluationReason[] = [];
  for (const rel of releases) {
    const verdict = judge(rel);
    ids.push(rel.record.id, ...verdict.evidenceIds);
    if (!verdict.ok && verdict.reason) faulty.push(verdict.reason);
  }
  if (faulty.length === 0) {
    const [fr, en] = texts.pass(releases.length);
    return result("PASS", [reason("ALL_RELEASES_OK", fr, en)], ids);
  }
  return result(
    "FAIL",
    detailed(faulty, {
      code: "FAULTY_RELEASE_COUNT",
      fr: (n) => texts.total(n, releases.length)[0],
      en: (n) => texts.total(n, releases.length)[1],
    }),
    ids,
  );
}

function workflowsOnRelease(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
  evalOnly: boolean,
): Evaluation {
  const runs = parsed(evidence, "github.workflow_run.completed", run);
  return perRelease(
    control,
    evidence,
    now,
    (rel) => {
      const relevant = runsFor(rel, runs).filter((r) => !evalOnly || isEval(r));
      const failed = relevant.filter((r) => FAILING.has(r.data.conclusion ?? ""));
      const succeeded = relevant.filter((r) => r.data.conclusion === "success");
      const ids = relevant.map((r) => r.record.id);
      const tag = rel.data.tagName;
      if (succeeded.length > 0 && failed.length === 0) return { ok: true, evidenceIds: ids };
      if (relevant.length === 0 || (succeeded.length === 0 && failed.length === 0)) {
        return {
          ok: false,
          evidenceIds: ids,
          reason: evalOnly
            ? reason(
                "NO_EVAL_RUN",
                `Release ${tag} : aucun workflow d'évaluation exécuté sur son commit.`,
                `Release ${tag}: no evaluation workflow ran on its commit.`,
                [rel.record.id],
              )
            : reason(
                "NO_TEST_RUN",
                `Release ${tag} : aucun workflow exécuté sur le tag.`,
                `Release ${tag}: no workflow ran on the tag.`,
                [rel.record.id],
              ),
        };
      }
      return {
        ok: false,
        evidenceIds: ids,
        reason: reason(
          evalOnly ? "EVAL_RUN_FAILED" : "TEST_RUN_FAILED",
          `Release ${tag} : ${failed.map((r) => r.data.workflowName ?? r.data.workflowPath).join(", ")} en échec.`,
          `Release ${tag}: ${failed.map((r) => r.data.workflowName ?? r.data.workflowPath).join(", ")} failed.`,
          [rel.record.id, ...failed.map((r) => r.record.id)],
        ),
      };
    },
    evalOnly
      ? {
          pass: (n) => [
            `Évaluation réussie sur le commit de chacune des ${n} releases.`,
            `Evaluation passed on the commit of each of the ${n} releases.`,
          ],
          total: (n, of) => [
            `${n} release(s) sur ${of} sans évaluation réussie.`,
            `${n} of ${of} release(s) without a passing evaluation.`,
          ],
        }
      : {
          pass: (n) => [
            `Tests réussis sur le tag de chacune des ${n} releases.`,
            `Tests passed on the tag of each of the ${n} releases.`,
          ],
          total: (n, of) => [
            `${n} release(s) sur ${of} sans tests réussis.`,
            `${n} of ${of} release(s) without passing tests.`,
          ],
        },
  );
}

export const evaluateEvalWorkflowOnRelease = (
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
) => workflowsOnRelease(control, evidence, now, true);

export const evaluateRegressionTestsOnRelease = (
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
) => workflowsOnRelease(control, evidence, now, false);

export function evaluateReleaseReferencesDocs(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const prefix = typeof control.params.path === "string" ? control.params.path : "docs/ai/";
  const docs = parsed(evidence, "github.file.snapshot", file).filter(
    (f) => f.data.present && f.data.path.startsWith(prefix),
  );
  return perRelease(
    control,
    evidence,
    now,
    (rel) => {
      const publishedAt = new Date(rel.data.publishedAt).getTime();
      const matching = docs.filter(
        (d) =>
          d.record.resourceId === rel.record.resourceId &&
          (d.data.ref === rel.data.tagName || new Date(d.data.takenAt).getTime() <= publishedAt),
      );
      if (matching.length > 0) return { ok: true, evidenceIds: matching.map((d) => d.record.id) };
      return {
        ok: false,
        evidenceIds: [],
        reason: reason(
          "RELEASE_WITHOUT_DOCS",
          `Release ${rel.data.tagName} : aucune version de la documentation (${prefix}) à sa date.`,
          `Release ${rel.data.tagName}: no documentation version (${prefix}) as of its date.`,
          [rel.record.id],
        ),
      };
    },
    {
      pass: (n) => [
        `Chacune des ${n} releases référence une version de la documentation.`,
        `Each of the ${n} releases references a documentation version.`,
      ],
      total: (n, of) => [
        `${n} release(s) sur ${of} sans version de la documentation.`,
        `${n} of ${of} release(s) without a documentation version.`,
      ],
    },
  );
}

export const evalWorkflowOnReleaseEvaluator: EvaluatorEntry = {
  version: "github.evalWorkflowOnRelease@1",
  evaluate: evaluateEvalWorkflowOnRelease,
};
export const regressionTestsOnReleaseEvaluator: EvaluatorEntry = {
  version: "github.regressionTestsOnRelease@1",
  evaluate: evaluateRegressionTestsOnRelease,
};
export const releaseReferencesDocsEvaluator: EvaluatorEntry = {
  version: "github.releaseReferencesDocs@1",
  evaluate: evaluateReleaseReferencesDocs,
};
