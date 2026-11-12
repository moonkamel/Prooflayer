// PL-402 — Évaluateurs GitHub et internes : au moins succès, échec, périmé, absent pour chacun (DoD du sprint 4).
// AIA-15-02 : jeux figés de tests/fixtures/rules/aia-15-02/ (prompt-type de PL-402).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EvaluableControl, EvidenceRecord } from "@/server/rules/engine";
import { EVALUATORS } from "@/server/rules/evaluators";
import {
  evaluateBranchProtection,
  evaluateRequiredChecks,
} from "@/server/rules/evaluators/github-branch-protection";
import { evaluateChangeManagementFiles } from "@/server/rules/evaluators/github-change-management";
import { evaluatePeerReview } from "@/server/rules/evaluators/github-peer-review";
import {
  evaluateEvalWorkflowOnRelease,
  evaluateRegressionTestsOnRelease,
  evaluateReleaseReferencesDocs,
} from "@/server/rules/evaluators/github-releases";
import {
  evaluateSecretScanning,
  evaluateVulnerabilityAge,
} from "@/server/rules/evaluators/github-security";
import {
  evaluateClassificationFresh,
  evaluatePackArchived,
  evaluateResponsibilitiesNamed,
} from "@/server/rules/evaluators/internal";
import { EVALUATOR_KEYS } from "@/server/rules/evaluator-keys";
import { CONTROL_LIBRARY } from "@/server/rules/library";

const now = new Date("2026-11-12T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);

/** Contrôle de la bibliothèque, avec une durée de fraîcheur imposée pour les cas « périmé ». */
function controlOf(key: string, overrides: Partial<EvaluableControl> = {}): EvaluableControl {
  const c = CONTROL_LIBRARY.find((d) => d.key === key)!;
  return {
    key: c.key,
    evaluatorKey: c.evaluatorKey,
    evidenceKinds: c.evidenceKinds,
    freshnessDays: c.freshnessDays,
    params: c.params,
    ...overrides,
  };
}

let seq = 0;
function ev(kind: string, payload: unknown, at: Date, extra: Partial<EvidenceRecord> = {}) {
  seq += 1;
  return {
    id: `ev_${String(seq).padStart(4, "0")}`,
    kind,
    resourceId: "res_1",
    occurredAt: at,
    capturedAt: at,
    payload,
    declarative: false,
    validUntil: null,
    linkedByUser: false,
    ...extra,
  } satisfies EvidenceRecord;
}

describe("registre", () => {
  it("les 13 évaluateurs de PL-402 sont livrés, sauf AIA-06-02 évalué à la signature", () => {
    const pl402 = Object.entries(EVALUATOR_KEYS)
      .filter(([, ticket]) => ticket === "PL-402")
      .map(([key]) => key);
    expect(pl402).toHaveLength(13);
    for (const key of pl402.filter((k) => k !== "internal.exemptionDossier")) {
      expect(EVALUATORS[key as keyof typeof EVALUATORS], key).toBeDefined();
    }
    expect(EVALUATORS["internal.exemptionDossier"]).toBeUndefined();
  });
});

// ─── AIA-15-02 : jeux figés ───

function fixture(name: string) {
  const raw = JSON.parse(
    readFileSync(join(__dirname, "..", "fixtures", "rules", "aia-15-02", `${name}.json`), "utf8"),
  ) as { now: string; params: Record<string, number>; evidence: Record<string, unknown>[] };
  return {
    now: new Date(raw.now),
    evidence: raw.evidence.map(
      (e) =>
        ({
          ...e,
          occurredAt: new Date(e.occurredAt as string),
          capturedAt: new Date(e.capturedAt as string),
        }) as EvidenceRecord,
    ),
    control: controlOf("AIA-15-02", { params: raw.params }),
  };
}

describe("AIA-15-02 github.peerReview", () => {
  it("succès à 87 PR", () => {
    const f = fixture("success-87");
    const result = evaluatePeerReview(f.control, f.evidence, f.now);
    expect(result.status).toBe("PASS");
    expect(result.reasons[0]!.message.fr).toContain("87 PR");
  });

  it("échec avec 2 PR auto-approuvées : une raison par PR fautive et le décompte", () => {
    const f = fixture("self-approved");
    const result = evaluatePeerReview(f.control, f.evidence, f.now);
    expect(result.status).toBe("FAIL");
    const unreviewed = result.reasons.filter((r) => r.code === "UNREVIEWED_PR");
    expect(unreviewed.map((r) => r.message.en)).toEqual([
      expect.stringContaining("#12"),
      expect.stringContaining("#31"),
    ]);
    expect(result.reasons.at(-1)).toMatchObject({ code: "UNREVIEWED_PR_COUNT" });
    expect(result.reasons.at(-1)!.message.fr).toContain("2 PR sur 40");
  });

  it("approbation postérieure à la fusion : ne compte pas", () => {
    const f = fixture("approval-after-merge");
    const result = evaluatePeerReview(f.control, f.evidence, f.now);
    expect(result.status).toBe("FAIL");
    expect(result.reasons.filter((r) => r.code === "UNREVIEWED_PR")).toHaveLength(1);
    expect(result.reasons[0]!.message.en).toContain("#4");
  });

  it("aucune PR → MISSING, NO_MERGED_PR", () => {
    const f = fixture("no-pr");
    expect(evaluatePeerReview(f.control, f.evidence, f.now)).toMatchObject({
      status: "MISSING",
      reasons: [{ code: "NO_MERGED_PR" }],
    });
  });

  it("fenêtre vide mais PR anciennes → MISSING", () => {
    const f = fixture("old-prs-only");
    const result = evaluatePeerReview(f.control, f.evidence, f.now);
    expect(result).toMatchObject({ status: "MISSING", reasons: [{ code: "NO_MERGED_PR" }] });
    expect(result.reasons[0]!.message.fr).toContain("90 derniers jours");
  });

  it("périmé : la PR la plus récente dépasse la durée de fraîcheur du contrôle → STALE", () => {
    const f = fixture("old-prs-only");
    const result = evaluatePeerReview({ ...f.control, freshnessDays: 30 }, f.evidence, f.now);
    expect(result).toMatchObject({ status: "STALE", reasons: [{ code: "EVIDENCE_STALE" }] });
  });

  it("PR dont l'auteur est un robot : comptée comme les autres", () => {
    const f = fixture("bot-author");
    const result = evaluatePeerReview(f.control, f.evidence, f.now);
    expect(result.status).toBe("FAIL");
    const unreviewed = result.reasons.filter((r) => r.code === "UNREVIEWED_PR");
    expect(unreviewed).toHaveLength(1);
    expect(unreviewed[0]!.message.en).toContain("#2");
    expect(result.reasons.at(-1)!.message.fr).toContain("1 PR sur 6");
  });

  it("au plus 20 raisons détaillées, puis le décompte total", () => {
    const f = fixture("success-87");
    const noReviews = f.evidence.filter((e) => e.kind !== "github.review.submitted");
    const result = evaluatePeerReview(f.control, noReviews, f.now);
    expect(result.reasons.filter((r) => r.code === "UNREVIEWED_PR")).toHaveLength(20);
    expect(result.reasons.at(-1)!.message.fr).toContain("87 PR sur 87");
  });

  it("PR et revues sont reliées par dépôt : une revue d'un autre dépôt ne compte pas", () => {
    const merged = ev(
      "github.pull_request.merged",
      { number: 1, author: "a", mergedAt: daysAgo(1).toISOString() },
      daysAgo(1),
    );
    const elsewhere = ev(
      "github.review.submitted",
      { pullNumber: 1, state: "APPROVED", reviewer: "b", submittedAt: daysAgo(2).toISOString() },
      daysAgo(2),
      { resourceId: "res_2" },
    );
    expect(evaluatePeerReview(controlOf("AIA-15-02"), [merged, elsewhere], now).status).toBe(
      "FAIL",
    );
  });
});

// ─── AIA-15-01 et AIA-15-03 : protection de branche ───

const protection = (overrides: Record<string, unknown> = {}) => ({
  branch: "main",
  defaultBranch: true,
  protected: true,
  requiredApprovingReviewCount: 1,
  dismissStaleReviews: true,
  requireCodeOwnerReviews: false,
  requiredStatusChecks: ["ci/test"],
  strictStatusChecks: true,
  enforceAdmins: true,
  requireLinearHistory: false,
  allowForcePushes: false,
  allowDeletions: false,
  takenAt: daysAgo(1).toISOString(),
  ...overrides,
});
const bp = (
  o: Record<string, unknown> = {},
  at = daysAgo(1),
  extra: Partial<EvidenceRecord> = {},
) => ev("github.branch_protection.snapshot", protection(o), at, extra);

describe("AIA-15-01 github.branchProtection", () => {
  const c = controlOf("AIA-15-01");
  it("succès : approbation exigée, sans contournement", () => {
    expect(evaluateBranchProtection(c, [bp()], now).status).toBe("PASS");
  });
  it("échec : branche non protégée, approbation non exigée, contournement par les administrateurs", () => {
    expect(evaluateBranchProtection(c, [bp({ protected: false })], now).reasons[0]!.code).toBe(
      "BRANCH_UNPROTECTED",
    );
    const r = evaluateBranchProtection(
      c,
      [bp({ requiredApprovingReviewCount: 0, enforceAdmins: false, allowForcePushes: true })],
      now,
    );
    expect(r.status).toBe("FAIL");
    expect(r.reasons.map((x) => x.code)).toEqual([
      "APPROVALS_NOT_REQUIRED",
      "ADMIN_BYPASS",
      "FORCE_PUSH_ALLOWED",
    ]);
  });
  it("seul le dernier instantané de chaque dépôt compte ; tous les dépôts doivent passer", () => {
    const older = bp({ protected: false }, daysAgo(5));
    expect(evaluateBranchProtection(c, [older, bp()], now).status).toBe("PASS");
    const otherRepo = bp({ enforceAdmins: false }, daysAgo(1), { resourceId: "res_2" });
    expect(evaluateBranchProtection(c, [bp(), otherRepo], now).status).toBe("FAIL");
  });
  it("périmé : dernier instantané au-delà de la durée de fraîcheur → STALE", () => {
    expect(
      evaluateBranchProtection({ ...c, freshnessDays: 7 }, [bp({}, daysAgo(10))], now).status,
    ).toBe("STALE");
  });
  it("absent : aucun instantané de la branche par défaut → MISSING", () => {
    expect(evaluateBranchProtection(c, [], now).status).toBe("MISSING");
    expect(evaluateBranchProtection(c, [bp({ defaultBranch: false })], now).status).toBe("MISSING");
  });
});

describe("AIA-15-03 github.requiredChecks", () => {
  const c = controlOf("AIA-15-03");
  it("succès : checks requis, imposés aux administrateurs", () => {
    expect(evaluateRequiredChecks(c, [bp()], now).status).toBe("PASS");
  });
  it("échec : aucun check requis, ou contournement possible", () => {
    expect(
      evaluateRequiredChecks(c, [bp({ requiredStatusChecks: [] })], now).reasons[0]!.code,
    ).toBe("NO_REQUIRED_CHECKS");
    expect(evaluateRequiredChecks(c, [bp({ enforceAdmins: false })], now).reasons[0]!.code).toBe(
      "ADMIN_BYPASS",
    );
  });
  it("périmé → STALE", () => {
    expect(
      evaluateRequiredChecks({ ...c, freshnessDays: 7 }, [bp({}, daysAgo(8))], now).status,
    ).toBe("STALE");
  });
  it("absent → MISSING", () => {
    expect(evaluateRequiredChecks(c, [], now).status).toBe("MISSING");
  });
});

// ─── AIA-09-04, AIA-15-04, AIA-11-02 : releases ───

const rel = (tag: string, at = daysAgo(3), extra: Record<string, unknown> = {}) =>
  ev(
    "github.release.published",
    {
      releaseId: 1,
      tagName: tag,
      name: tag,
      targetCommitish: "main",
      prerelease: false,
      publishedAt: at.toISOString(),
      author: "amina",
      ...extra,
    },
    at,
  );
let runId = 100;
const run = (tag: string, name: string, conclusion: string, extra: Record<string, unknown> = {}) =>
  ev(
    "github.workflow_run.completed",
    {
      runId: (runId += 1),
      runAttempt: 1,
      workflowName: name,
      workflowPath: `.github/workflows/${name}.yml`,
      event: "release",
      headBranch: tag,
      headSha: `sha_${tag}`,
      status: "completed",
      conclusion,
      startedAt: daysAgo(3).toISOString(),
      completedAt: daysAgo(3).toISOString(),
      defaultBranch: false,
      ...extra,
    },
    daysAgo(3),
  );

describe("AIA-09-04 github.evalWorkflowOnRelease", () => {
  const c = controlOf("AIA-09-04");
  it("succès : un workflow eval réussi sur chaque release", () => {
    expect(
      evaluateEvalWorkflowOnRelease(
        c,
        [
          rel("v1.0"),
          run("v1.0", "eval", "success"),
          rel("v1.1"),
          run("v1.1", "model-eval", "success"),
        ],
        now,
      ).status,
    ).toBe("PASS");
  });
  it("échec : release sans évaluation, ou évaluation en échec (dernière tentative)", () => {
    const r = evaluateEvalWorkflowOnRelease(
      c,
      [rel("v1.0"), run("v1.0", "test", "success"), rel("v1.1"), run("v1.1", "eval", "failure")],
      now,
    );
    expect(r.status).toBe("FAIL");
    expect(r.reasons.map((x) => x.code)).toEqual([
      "NO_EVAL_RUN",
      "EVAL_RUN_FAILED",
      "FAULTY_RELEASE_COUNT",
    ]);
    // Relancé avec succès : la dernière tentative fait foi.
    const failed = run("v1.1", "eval", "failure");
    const retried = run("v1.1", "eval", "success", {
      runId: (failed.payload as { runId: number }).runId,
      runAttempt: 2,
    });
    expect(evaluateEvalWorkflowOnRelease(c, [rel("v1.1"), failed, retried], now).status).toBe(
      "PASS",
    );
  });
  it("périmé → STALE", () => {
    expect(
      evaluateEvalWorkflowOnRelease(
        { ...c, freshnessDays: 1 },
        [rel("v1.0"), run("v1.0", "eval", "success")],
        now,
      ).status,
    ).toBe("STALE");
  });
  it("absent : aucune release (les préversions ne comptent pas) → MISSING", () => {
    expect(evaluateEvalWorkflowOnRelease(c, [], now).status).toBe("MISSING");
    expect(
      evaluateEvalWorkflowOnRelease(c, [rel("v2.0-rc1", daysAgo(1), { prerelease: true })], now)
        .status,
    ).toBe("MISSING");
  });
});

describe("AIA-15-04 github.regressionTestsOnRelease", () => {
  const c = controlOf("AIA-15-04");
  it("succès : workflows réussis sur le tag, rattachés aussi par commit cible", () => {
    const byCommit = rel("v1.0", daysAgo(3), { targetCommitish: "abc" });
    expect(
      evaluateRegressionTestsOnRelease(
        c,
        [byCommit, run("other", "test", "success", { headBranch: "main", headSha: "abc" })],
        now,
      ).status,
    ).toBe("PASS");
  });
  it("échec : un workflow en échec sur le tag, ou aucun workflow", () => {
    expect(
      evaluateRegressionTestsOnRelease(
        c,
        [rel("v1.0"), run("v1.0", "test", "success"), run("v1.0", "lint", "failure")],
        now,
      ).reasons[0]!.code,
    ).toBe("TEST_RUN_FAILED");
    expect(evaluateRegressionTestsOnRelease(c, [rel("v1.0")], now).reasons[0]!.code).toBe(
      "NO_TEST_RUN",
    );
  });
  it("une exécution d'un autre dépôt ne compte pas", () => {
    expect(
      evaluateRegressionTestsOnRelease(
        c,
        [rel("v1.0"), { ...run("v1.0", "test", "success"), resourceId: "res_2" }],
        now,
      ).status,
    ).toBe("FAIL");
  });
  it("périmé → STALE", () => {
    expect(
      evaluateRegressionTestsOnRelease(
        { ...c, freshnessDays: 1 },
        [rel("v1.0"), run("v1.0", "test", "success")],
        now,
      ).status,
    ).toBe("STALE");
  });
  it("absent → MISSING", () => {
    expect(evaluateRegressionTestsOnRelease(c, [], now).status).toBe("MISSING");
  });
});

const fileSnap = (
  path: string,
  present: boolean,
  at: Date,
  ref = "main",
  extra: Partial<EvidenceRecord> = {},
) =>
  ev(
    "github.file.snapshot",
    {
      path,
      ref,
      present,
      blobSha: present ? "b" : null,
      size: present ? 1 : null,
      takenAt: at.toISOString(),
    },
    at,
    extra,
  );

describe("AIA-11-02 github.releaseReferencesDocs", () => {
  const c = controlOf("AIA-11-02");
  it("succès : documentation présente sous docs/ai/ à la date de la release, ou capturée sur le tag", () => {
    expect(
      evaluateReleaseReferencesDocs(
        c,
        [rel("v1.0", daysAgo(3)), fileSnap("docs/ai/model-card.md", true, daysAgo(5))],
        now,
      ).status,
    ).toBe("PASS");
    expect(
      evaluateReleaseReferencesDocs(
        c,
        [rel("v1.0", daysAgo(3)), fileSnap("docs/ai/model-card.md", true, daysAgo(1), "v1.0")],
        now,
      ).status,
    ).toBe("PASS");
  });
  it("échec : documentation créée après la release, ou absente", () => {
    const r = evaluateReleaseReferencesDocs(
      c,
      [rel("v1.0", daysAgo(3)), fileSnap("docs/ai/model-card.md", true, daysAgo(1))],
      now,
    );
    expect(r.status).toBe("FAIL");
    expect(r.reasons[0]!.code).toBe("RELEASE_WITHOUT_DOCS");
    expect(
      evaluateReleaseReferencesDocs(
        c,
        [
          rel("v1.0", daysAgo(3)),
          fileSnap("docs/ai/model-card.md", false, daysAgo(5)),
          fileSnap("README.md", true, daysAgo(5)),
        ],
        now,
      ).status,
    ).toBe("FAIL");
  });
  it("périmé → STALE", () => {
    expect(
      evaluateReleaseReferencesDocs(
        { ...c, freshnessDays: 1 },
        [rel("v1.0", daysAgo(3)), fileSnap("docs/ai/a.md", true, daysAgo(5))],
        now,
      ).status,
    ).toBe("STALE");
  });
  it("absent → MISSING", () => {
    expect(
      evaluateReleaseReferencesDocs(c, [fileSnap("docs/ai/a.md", true, daysAgo(5))], now).status,
    ).toBe("MISSING");
  });
});

// ─── AIA-15-05 et AIA-15-06 : alertes de sécurité ───

const severities = (critical: string | null = null, high: string | null = null) => ({
  open: { critical: critical ? 1 : 0, high: high ? 1 : 0, medium: 0, low: 0 },
  oldestOpenAt: { critical, high, medium: null, low: null },
});
const alerts = (
  o: { dependabot?: unknown; codeScanning?: unknown; secretScanning?: unknown } = {},
  at = daysAgo(1),
  extra: Partial<EvidenceRecord> = {},
) =>
  ev(
    "github.security_alerts.snapshot",
    {
      dependabot: severities(),
      codeScanning: severities(),
      secretScanning: { enabled: true, open: 0, oldestOpenAt: null },
      takenAt: at.toISOString(),
      ...o,
    },
    at,
    extra,
  );

describe("AIA-15-05 github.vulnerabilityAge", () => {
  const c = controlOf("AIA-15-05");
  it("succès : vulnérabilités récentes seulement (critique < 30 j, élevée < 90 j)", () => {
    const r = evaluateVulnerabilityAge(
      c,
      [alerts({ dependabot: severities(daysAgo(10).toISOString(), daysAgo(80).toISOString()) })],
      now,
    );
    expect(r.status).toBe("PASS");
  });
  it("échec : critique ouverte depuis plus de 30 jours, élevée depuis plus de 90 jours", () => {
    const r = evaluateVulnerabilityAge(
      c,
      [
        alerts({
          dependabot: severities(daysAgo(31).toISOString()),
          codeScanning: severities(null, daysAgo(120).toISOString()),
        }),
      ],
      now,
    );
    expect(r.status).toBe("FAIL");
    expect(r.reasons.map((x) => x.code)).toEqual(["CRITICAL_TOO_OLD", "HIGH_TOO_OLD"]);
  });
  it("alertes inaccessibles : MISSING sur tous les dépôts, PARTIAL sur une partie", () => {
    expect(
      evaluateVulnerabilityAge(c, [alerts({ dependabot: null, codeScanning: null })], now).status,
    ).toBe("MISSING");
    expect(
      evaluateVulnerabilityAge(
        c,
        [
          alerts(),
          alerts({ dependabot: null, codeScanning: null }, daysAgo(1), { resourceId: "res_2" }),
        ],
        now,
      ).status,
    ).toBe("PARTIAL");
  });
  it("périmé → STALE", () => {
    expect(
      evaluateVulnerabilityAge({ ...c, freshnessDays: 2 }, [alerts({}, daysAgo(3))], now).status,
    ).toBe("STALE");
  });
  it("absent → MISSING", () => {
    expect(evaluateVulnerabilityAge(c, [], now).status).toBe("MISSING");
  });
});

describe("AIA-15-06 github.secretScanning", () => {
  const c = controlOf("AIA-15-06");
  it("succès : détection active, aucun secret ouvert", () => {
    expect(evaluateSecretScanning(c, [alerts()], now).status).toBe("PASS");
  });
  it("échec : détection inactive, ou secret ouvert", () => {
    expect(
      evaluateSecretScanning(
        c,
        [alerts({ secretScanning: { enabled: false, open: null, oldestOpenAt: null } })],
        now,
      ).reasons[0]!.code,
    ).toBe("SECRET_SCANNING_DISABLED");
    expect(
      evaluateSecretScanning(
        c,
        [
          alerts({
            secretScanning: { enabled: true, open: 2, oldestOpenAt: daysAgo(4).toISOString() },
          }),
        ],
        now,
      ).reasons[0]!.code,
    ).toBe("OPEN_SECRET");
  });
  it("détection active mais alertes illisibles → PARTIAL", () => {
    expect(
      evaluateSecretScanning(
        c,
        [alerts({ secretScanning: { enabled: true, open: null, oldestOpenAt: null } })],
        now,
      ).status,
    ).toBe("PARTIAL");
  });
  it("périmé → STALE", () => {
    expect(
      evaluateSecretScanning({ ...c, freshnessDays: 2 }, [alerts({}, daysAgo(3))], now).status,
    ).toBe("STALE");
  });
  it("absent → MISSING", () => {
    expect(evaluateSecretScanning(c, [], now).status).toBe("MISSING");
  });
});

// ─── AIA-17-02 : gestion des changements ───

describe("AIA-17-02 github.changeManagementFiles", () => {
  const c = controlOf("AIA-17-02");
  it("succès : gabarit de PR et CODEOWNERS sur chaque dépôt (emplacements GitHub)", () => {
    expect(
      evaluateChangeManagementFiles(
        c,
        [
          fileSnap(".github/pull_request_template.md", true, daysAgo(1)),
          fileSnap(".github/CODEOWNERS", true, daysAgo(1)),
        ],
        now,
      ).status,
    ).toBe("PASS");
    expect(
      evaluateChangeManagementFiles(
        c,
        [
          fileSnap(".github/PULL_REQUEST_TEMPLATE/model.md", true, daysAgo(1)),
          fileSnap("CODEOWNERS", true, daysAgo(1)),
        ],
        now,
      ).status,
    ).toBe("PASS");
  });
  it("échec : aucun des deux présent ; partiel : un seul", () => {
    expect(
      evaluateChangeManagementFiles(
        c,
        [
          fileSnap(".github/pull_request_template.md", false, daysAgo(1)),
          fileSnap("CODEOWNERS", false, daysAgo(1)),
        ],
        now,
      ).status,
    ).toBe("FAIL");
    const partial = evaluateChangeManagementFiles(
      c,
      [
        fileSnap(".github/pull_request_template.md", true, daysAgo(1)),
        fileSnap("CODEOWNERS", false, daysAgo(1)),
      ],
      now,
    );
    expect(partial).toMatchObject({ status: "PARTIAL", reasons: [{ code: "NO_CODEOWNERS" }] });
  });
  it("le dernier instantané fait foi : CODEOWNERS supprimé", () => {
    expect(
      evaluateChangeManagementFiles(
        c,
        [
          fileSnap(".github/pull_request_template.md", true, daysAgo(1)),
          fileSnap("CODEOWNERS", true, daysAgo(5)),
          fileSnap("CODEOWNERS", false, daysAgo(1)),
        ],
        now,
      ).status,
    ).toBe("PARTIAL");
  });
  it("périmé → STALE", () => {
    expect(
      evaluateChangeManagementFiles(
        { ...c, freshnessDays: 2 },
        [fileSnap("CODEOWNERS", true, daysAgo(3))],
        now,
      ).status,
    ).toBe("STALE");
  });
  it("absent : seulement d'autres fichiers → MISSING", () => {
    expect(
      evaluateChangeManagementFiles(c, [fileSnap("docs/ai/a.md", true, daysAgo(1))], now).status,
    ).toBe("MISSING");
  });
});

// ─── Internes ───

const signed = (at: Date) =>
  ev(
    "system.classification.signed",
    {
      systemId: "sys_1",
      classificationId: "cls_1",
      tier: "HIGH_RISK",
      role: "PROVIDER",
      rulesetVersion: "2026.11.0",
      signedAt: at.toISOString(),
      signedByUserId: "usr_clara",
    },
    at,
  );
const registry = (at: Date, o: Record<string, unknown> = {}) =>
  ev(
    "system.registry.snapshot",
    {
      systemId: "sys_1",
      ownerUserId: "usr_owner",
      oversightOwnerUserId: "usr_oversight",
      complianceSignerUserId: "usr_clara",
      classificationStale: false,
      archived: false,
      updatedAt: at.toISOString(),
      ...o,
    },
    at,
  );

describe("AIA-06-01 internal.classificationFresh", () => {
  const c = controlOf("AIA-06-01");
  it("succès : signée il y a moins de 12 mois, fiche non modifiée depuis", () => {
    expect(
      evaluateClassificationFresh(c, [signed(daysAgo(30)), registry(daysAgo(30))], now).status,
    ).toBe("PASS");
  });
  it("échec : fiche modifiée après la signature (classification à revoir)", () => {
    const r = evaluateClassificationFresh(
      c,
      [
        signed(daysAgo(30)),
        registry(daysAgo(30)),
        registry(daysAgo(2), { classificationStale: true }),
      ],
      now,
    );
    expect(r).toMatchObject({ status: "FAIL", reasons: [{ code: "CLASSIFICATION_TO_REVIEW" }] });
    // Un instantané « à revoir » antérieur à une nouvelle signature ne compte plus.
    expect(
      evaluateClassificationFresh(
        c,
        [registry(daysAgo(40), { classificationStale: true }), signed(daysAgo(30))],
        now,
      ).status,
    ).toBe("PASS");
  });
  it("périmé : signée il y a plus de 365 jours → STALE", () => {
    expect(evaluateClassificationFresh(c, [signed(daysAgo(366))], now)).toMatchObject({
      status: "STALE",
      reasons: [{ code: "CLASSIFICATION_TOO_OLD" }],
    });
  });
  it("absent : aucune classification signée → MISSING", () => {
    expect(evaluateClassificationFresh(c, [registry(daysAgo(1))], now).status).toBe("MISSING");
  });
});

describe("AIA-17-03 internal.responsibilitiesNamed", () => {
  const c = controlOf("AIA-17-03");
  it("succès : système, contrôle humain et conformité nommés", () => {
    expect(evaluateResponsibilitiesNamed(c, [registry(daysAgo(1))], now).status).toBe("PASS");
  });
  it("échec : aucun responsable ; partiel : responsable du contrôle humain manquant", () => {
    expect(
      evaluateResponsibilitiesNamed(
        c,
        [
          registry(daysAgo(1), {
            ownerUserId: null,
            oversightOwnerUserId: null,
            complianceSignerUserId: null,
          }),
        ],
        now,
      ).status,
    ).toBe("FAIL");
    const r = evaluateResponsibilitiesNamed(
      c,
      [registry(daysAgo(1), { oversightOwnerUserId: null })],
      now,
    );
    expect(r).toMatchObject({ status: "PARTIAL", reasons: [{ code: "NO_OVERSIGHT_OWNER" }] });
  });
  it("le dernier instantané fait foi", () => {
    expect(
      evaluateResponsibilitiesNamed(
        c,
        [registry(daysAgo(5), { oversightOwnerUserId: null }), registry(daysAgo(1))],
        now,
      ).status,
    ).toBe("PASS");
  });
  it("périmé → STALE", () => {
    expect(
      evaluateResponsibilitiesNamed({ ...c, freshnessDays: 30 }, [registry(daysAgo(31))], now)
        .status,
    ).toBe("STALE");
  });
  it("absent → MISSING", () => {
    expect(evaluateResponsibilitiesNamed(c, [], now).status).toBe("MISSING");
  });
});

const pack = (at: Date) =>
  ev(
    "system.pack.generated",
    { systemId: "sys_1", packId: `pk_${seq}`, generatedAt: at.toISOString() },
    at,
  );

describe("AIA-17-04 internal.packArchived", () => {
  const c = controlOf("AIA-17-04");
  it("succès : packs réguliers, le dernier il y a moins de 183 jours", () => {
    expect(
      evaluatePackArchived(c, [pack(daysAgo(300)), pack(daysAgo(150)), pack(daysAgo(10))], now)
        .status,
    ).toBe("PASS");
  });
  it("échec : plus de 183 jours sans pack au cours des douze derniers mois", () => {
    expect(evaluatePackArchived(c, [pack(daysAgo(250)), pack(daysAgo(10))], now)).toMatchObject({
      status: "FAIL",
      reasons: [{ code: "PACK_GAP" }],
    });
    // Un écart plus ancien que douze mois ne compte plus.
    expect(
      evaluatePackArchived(
        c,
        [pack(daysAgo(700)), pack(daysAgo(300)), pack(daysAgo(150)), pack(daysAgo(10))],
        now,
      ).status,
    ).toBe("PASS");
  });
  it("périmé : dernier pack il y a plus de 183 jours → STALE", () => {
    expect(evaluatePackArchived(c, [pack(daysAgo(200))], now)).toMatchObject({
      status: "STALE",
      reasons: [{ code: "PACK_TOO_OLD" }],
    });
  });
  it("absent : aucun pack → MISSING", () => {
    expect(evaluatePackArchived(c, [], now).status).toBe("MISSING");
  });
});

describe("aucun évaluateur n'écrit « conforme »", () => {
  it("raisons françaises", () => {
    const outputs = [
      evaluatePeerReview(controlOf("AIA-15-02"), fixture("success-87").evidence, now),
      evaluateBranchProtection(controlOf("AIA-15-01"), [bp()], now),
      evaluateResponsibilitiesNamed(controlOf("AIA-17-03"), [registry(daysAgo(1))], now),
    ];
    for (const o of outputs)
      for (const r of o.reasons) expect(r.message.fr).not.toMatch(/conforme/iu);
  });
});
