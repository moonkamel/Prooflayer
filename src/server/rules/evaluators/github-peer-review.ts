// AIA-15-02, clé `github.peerReview` (prompt-type de PL-402) : « 100 % des PR fusionnées sur la fenêtre sont approuvées
// par un relecteur distinct de l'auteur ». Fonction pure.
// - Fenêtre [now - windowDays, now] sur la date de fusion (occurredAt de la PR).
// - Une approbation compte si state = APPROVED, si son auteur diffère de l'auteur de la PR et si elle est antérieure à
//   la fusion ; PR et revues sont reliées par le numéro de PR et la ressource (dépôt).
// - Une PR dont l'auteur est un robot compte comme les autres.
import { z } from "zod";
import {
  reason,
  windowStart,
  type EvaluableControl,
  type EvidenceRecord,
  type EvaluatorEntry,
} from "../engine";
import type { Evaluation } from "../evaluation";
import { detailed, missing, numberParam, parsed, result, staleness } from "./common";

const pr = z.object({
  number: z.number().int(),
  author: z.string().nullable(),
  mergedAt: z.string().datetime(),
});
const review = z.object({
  pullNumber: z.number().int(),
  state: z.string(),
  reviewer: z.string().nullable(),
  submittedAt: z.string().datetime(),
});

const pullKey = (resourceId: string | null, number: number) => `${resourceId ?? ""}#${number}`;

export function evaluatePeerReview(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const windowDays = numberParam(control, "windowDays", 90);
  const minApprovals = numberParam(control, "minApprovals", 1);
  const pulls = parsed(evidence, "github.pull_request.merged", pr);
  if (pulls.length === 0) {
    return missing(
      "NO_MERGED_PR",
      "Aucune PR fusionnée n'a été capturée.",
      "No merged pull request has been captured.",
    );
  }
  const stale = staleness(
    control,
    pulls.map((p) => p.record),
    now,
  );
  if (stale) return stale;
  const from = windowStart(now, windowDays);
  const inWindow = pulls.filter((p) => p.record.occurredAt >= from && p.record.occurredAt <= now);
  if (inWindow.length === 0) {
    return missing(
      "NO_MERGED_PR",
      `Aucune PR fusionnée sur les ${windowDays} derniers jours.`,
      `No pull request merged in the last ${windowDays} days.`,
    );
  }

  const reviewsByPull = new Map<
    string,
    { id: string; reviewer: string | null; state: string; at: Date }[]
  >();
  for (const r of parsed(evidence, "github.review.submitted", review)) {
    const key = pullKey(r.record.resourceId, r.data.pullNumber);
    const list = reviewsByPull.get(key) ?? [];
    list.push({
      id: r.record.id,
      reviewer: r.data.reviewer,
      state: r.data.state.toUpperCase(),
      at: new Date(r.data.submittedAt),
    });
    reviewsByPull.set(key, list);
  }

  const evidenceIds: string[] = [];
  const faulty: ReturnType<typeof reason>[] = [];
  for (const p of inWindow) {
    const mergedAt = new Date(p.data.mergedAt);
    const approvals = (reviewsByPull.get(pullKey(p.record.resourceId, p.data.number)) ?? []).filter(
      (r) =>
        r.state === "APPROVED" &&
        r.reviewer !== null &&
        r.reviewer !== p.data.author &&
        r.at.getTime() < mergedAt.getTime(),
    );
    const reviewers = new Set(approvals.map((a) => a.reviewer));
    evidenceIds.push(p.record.id, ...approvals.map((a) => a.id));
    if (reviewers.size < minApprovals) {
      faulty.push(
        reason(
          "UNREVIEWED_PR",
          `PR n° ${p.data.number} fusionnée sans approbation d'un relecteur distinct de l'auteur.`,
          `PR #${p.data.number} merged without approval from a reviewer other than its author.`,
          [p.record.id],
        ),
      );
    }
  }

  if (faulty.length === 0) {
    return result(
      "PASS",
      [
        reason(
          "ALL_PR_REVIEWED",
          `${inWindow.length} PR fusionnées sur ${windowDays} jours, toutes approuvées par un relecteur distinct de l'auteur.`,
          `${inWindow.length} pull requests merged in ${windowDays} days, all approved by a reviewer other than the author.`,
        ),
      ],
      evidenceIds,
    );
  }
  return result(
    "FAIL",
    detailed(faulty, {
      code: "UNREVIEWED_PR_COUNT",
      fr: (n) => `${n} PR sur ${inWindow.length} fusionnées sans relecture par un tiers.`,
      en: (n) => `${n} of ${inWindow.length} pull requests merged without third-party review.`,
    }),
    evidenceIds,
  );
}

export const peerReviewEvaluator: EvaluatorEntry = {
  version: "github.peerReview@1",
  evaluate: evaluatePeerReview,
};
