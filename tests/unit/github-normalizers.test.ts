// PL-305 — Normaliseurs GitHub : 3 charges réelles anonymisées par type (tests/fixtures/github/), liste blanche
// stricte, cas négatifs, et équivalence webhook / GraphQL pour les PR fusionnées (prompt-type de PL-305).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeBranchProtectionSnapshot,
  normalizeFileSnapshot,
  normalizePullRequestMerged,
  normalizeReleasePublished,
  normalizeReviewSubmitted,
  normalizeSecurityAlertsSnapshot,
  normalizeWebhook,
  normalizeWorkflowRunCompleted,
  pullRequestFromGraphQL,
  type GitHubEvidence,
  type NormalizerContext,
} from "@/server/connectors/github/normalizers";

// Fixture JSON lue sans type : on y accède comme à une charge GitHub.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- charges JSON de test, structure variable
type Fixture = Record<string, any>;

const FIXTURES = join(__dirname, "..", "fixtures", "github");
const fixtures = (dir: string) =>
  readdirSync(join(FIXTURES, dir))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(FIXTURES, dir, f), "utf8")) as Fixture);

const ctx: NormalizerContext = {
  orgId: "org_1",
  resourceId: "res_1",
  capturedVia: "WEBHOOK",
  warn: () => {},
};

/** Ce qui ne doit jamais sortir d'un normaliseur, présent à dessein dans les fixtures. */
const FORBIDDEN = [
  "@talvio.example",
  "@banque-x.example",
  "Contexte confidentiel",
  "commentaire privé",
  "Notes internes",
  "Message de commit",
  "AKIAIOSFODNN7EXAMPLE",
  "IyBOb3RpY2Ug",
  "model.bin",
  "requirements.txt",
  "api/db.py",
  "pyyaml",
];
function expectWhitelisted(output: unknown, keys: string[]) {
  const text = JSON.stringify(output);
  for (const word of FORBIDDEN) expect(text, word).not.toContain(word);
  for (const evidence of output as { payload: Record<string, unknown> }[]) {
    expect(Object.keys(evidence.payload).sort()).toEqual([...keys].sort());
  }
}

describe("github.pull_request.merged", () => {
  const all = fixtures("pull_request");
  const keys = [
    "number",
    "title",
    "baseRef",
    "headSha",
    "mergeCommitSha",
    "mergedAt",
    "author",
    "mergedBy",
    "changedFiles",
    "labels",
    "draft",
  ];

  it.each(all.map((f, i) => [i + 1, f]))("charge %i → une preuve minimisée", (_, f) => {
    const [evidence, ...rest] = normalizePullRequestMerged(f, ctx);
    expect(rest).toEqual([]);
    const pr = f.pull_request;
    expect(evidence).toMatchObject({
      kind: "github.pull_request.merged",
      source: "GITHUB",
      capturedVia: "WEBHOOK",
      resourceId: "res_1",
      sourceRef: `${f.repository.id}#${pr.number}`,
      sourceUrl: pr.html_url,
      dedupeKey: `gh:pr:${f.repository.id}:${pr.number}:merged`,
      summary: `PR #${pr.number} fusionnée dans ${pr.base.ref}`,
      actor: { login: pr.user.login },
    });
    expect(evidence!.occurredAt.toISOString()).toBe(new Date(pr.merged_at).toISOString());
    expect(evidence!.payload).toMatchObject({
      mergedBy: pr.merged_by.login,
      changedFiles: pr.changed_files,
    });
    expectWhitelisted([evidence], keys);
  });

  it("rien si la PR n'est pas fusionnée ou ne vise pas la branche par défaut", () => {
    const f = structuredClone(all[0]!);
    f.pull_request.merged = false;
    expect(normalizePullRequestMerged(f, ctx)).toEqual([]);
    const g = structuredClone(all[0]!);
    g.pull_request.base.ref = "feature/autre";
    expect(normalizePullRequestMerged(g, ctx)).toEqual([]);
  });

  it("charge tronquée : [] et un avertissement qui ne contient pas la charge", () => {
    const warn = vi.fn();
    const truncated = {
      action: "closed",
      pull_request: { number: 214, title: "Contexte confidentiel" },
    };
    expect(normalizePullRequestMerged(truncated, { ...ctx, warn })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(
      /^normaliseur github\.pull_request\.merged : charge invalide/u,
    );
    expect(String(warn.mock.calls[0]![0])).not.toContain("confidentiel");
    expect(normalizePullRequestMerged(null, { ...ctx, warn })).toEqual([]);
  });

  it("webhook et GraphQL donnent le même dedupeKey et le même payload", () => {
    for (const f of all) {
      const pr = f.pull_request;
      const node = {
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        merged: true,
        mergedAt: pr.merged_at,
        mergeCommit: { oid: pr.merge_commit_sha },
        headRefOid: pr.head.sha,
        baseRefName: pr.base.ref,
        isDraft: pr.draft,
        changedFiles: pr.changed_files,
        author: { login: pr.user.login },
        mergedBy: { login: pr.merged_by.login },
        labels: {
          nodes: [...pr.labels].reverse().map((l: { name: string }) => ({ name: l.name })),
        },
        repository: {
          databaseId: f.repository.id,
          defaultBranchRef: { name: f.repository.default_branch },
        },
      };
      const [fromHook] = normalizePullRequestMerged(f, ctx);
      const [fromGraph] = pullRequestFromGraphQL(node, { ...ctx, capturedVia: "BACKFILL" });
      expect(fromGraph!.dedupeKey).toBe(fromHook!.dedupeKey);
      expect(fromGraph!.payload).toEqual(fromHook!.payload);
      expect(fromGraph!.capturedVia).toBe("BACKFILL");
    }
    expect(pullRequestFromGraphQL({ number: 1 }, ctx)).toEqual([]);
  });
});

describe("github.review.submitted", () => {
  it.each(fixtures("pull_request_review").map((f, i) => [i + 1, f]))("charge %i", (_, f) => {
    const [evidence] = normalizeReviewSubmitted(f, ctx);
    expect(evidence).toMatchObject({
      dedupeKey: `gh:review:${f.repository.id}:${f.review.id}`,
      payload: {
        pullNumber: f.pull_request.number,
        state: f.review.state.toUpperCase(),
        reviewer: f.review.user.login,
        pullAuthor: f.pull_request.user.login,
      },
    });
    expectWhitelisted(
      [evidence],
      ["pullNumber", "reviewId", "state", "reviewer", "pullAuthor", "commitId", "submittedAt"],
    );
  });
});

describe("github.workflow_run.completed", () => {
  it.each(fixtures("workflow_run").map((f, i) => [i + 1, f]))("charge %i", (_, f) => {
    const [evidence] = normalizeWorkflowRunCompleted(f, ctx);
    const run = f.workflow_run;
    expect(evidence).toMatchObject({
      dedupeKey: `gh:run:${f.repository.id}:${run.id}:${run.run_attempt}`,
      payload: { conclusion: run.conclusion, workflowPath: run.path, event: run.event },
    });
    expectWhitelisted(
      [evidence],
      [
        "runId",
        "runAttempt",
        "workflowName",
        "workflowPath",
        "event",
        "headBranch",
        "headSha",
        "status",
        "conclusion",
        "startedAt",
        "completedAt",
        "defaultBranch",
      ],
    );
  });
});

describe("github.release.published", () => {
  const all = fixtures("release");
  it.each(all.map((f, i) => [i + 1, f]))("charge %i", (_, f) => {
    const [evidence] = normalizeReleasePublished(f, ctx);
    expect(evidence).toMatchObject({
      dedupeKey: `gh:release:${f.repository.id}:${f.release.id}`,
      payload: { tagName: f.release.tag_name, prerelease: f.release.prerelease },
    });
    expectWhitelisted(
      [evidence],
      ["releaseId", "tagName", "name", "targetCommitish", "prerelease", "publishedAt", "author"],
    );
  });

  it("un brouillon ne donne aucune preuve", () => {
    const f = structuredClone(all[0]!);
    f.release.draft = true;
    expect(normalizeReleasePublished(f, ctx)).toEqual([]);
  });
});

describe("github.branch_protection.snapshot", () => {
  const all = fixtures("branch_protection");
  const keys = [
    "branch",
    "defaultBranch",
    "protected",
    "requiredApprovingReviewCount",
    "dismissStaleReviews",
    "requireCodeOwnerReviews",
    "requiredStatusChecks",
    "strictStatusChecks",
    "enforceAdmins",
    "requireLinearHistory",
    "allowForcePushes",
    "allowDeletions",
    "takenAt",
  ];

  it("protégée, faiblement protégée, non protégée", () => {
    const [strong, weak, none] = all.map((f) => normalizeBranchProtectionSnapshot(f, ctx)[0]!) as [
      GitHubEvidence,
      GitHubEvidence,
      GitHubEvidence,
    ];
    expect(strong.payload).toMatchObject({
      protected: true,
      requiredApprovingReviewCount: 1,
      requireCodeOwnerReviews: true,
      requiredStatusChecks: ["ci", "eval"],
      strictStatusChecks: true,
      enforceAdmins: true,
      allowForcePushes: false,
    });
    expect(weak.payload).toMatchObject({
      protected: true,
      requiredApprovingReviewCount: 0,
      requiredStatusChecks: [],
      allowForcePushes: true,
    });
    expect(none.payload).toMatchObject({ protected: false, requiredApprovingReviewCount: 0 });
    expect(none.summary).toBe("Branche main non protégée");
    expectWhitelisted([strong, weak, none], keys);
  });

  it("une preuve par jour et par état : même état → même clé ; état changé → nouvelle clé", () => {
    const f = all[0]!;
    const same = normalizeBranchProtectionSnapshot(
      { ...f, takenAt: "2026-11-12T18:00:00Z" },
      ctx,
    )[0]!;
    expect(same.dedupeKey).toBe(normalizeBranchProtectionSnapshot(f, ctx)[0]!.dedupeKey);
    const changed = structuredClone(f);
    changed.protection.enforce_admins.enabled = false;
    expect(normalizeBranchProtectionSnapshot(changed, ctx)[0]!.dedupeKey).not.toBe(same.dedupeKey);
    const nextDay = normalizeBranchProtectionSnapshot(
      { ...f, takenAt: "2026-11-13T03:00:00Z" },
      ctx,
    )[0]!;
    expect(nextDay.dedupeKey).not.toBe(same.dedupeKey);
  });
});

describe("github.file.snapshot", () => {
  it("présence et empreinte, jamais le contenu", () => {
    const out = fixtures("file").map((f) => normalizeFileSnapshot(f, ctx)[0]!);
    expect(out.map((e) => [e.payload.path, e.payload.present])).toEqual([
      ["docs/ai/instructions-for-use.md", true],
      ["CODEOWNERS", true],
      ["docs/ai/datasheets/candidates.md", false],
    ]);
    expect(out[2]!.dedupeKey).toContain(":absent:");
    expectWhitelisted(out, ["path", "ref", "present", "blobSha", "size", "takenAt"]);
  });
});

describe("github.security_alerts.snapshot", () => {
  it("décomptes ouverts par gravité et plus ancienne date, sans détail d'alerte", () => {
    const [first, clean, partial] = fixtures("security_alerts").map(
      (f) => normalizeSecurityAlertsSnapshot(f, ctx)[0]!,
    ) as [GitHubEvidence, GitHubEvidence, GitHubEvidence];
    expect(first.payload).toMatchObject({
      dependabot: {
        open: { critical: 1, high: 1, medium: 0, low: 0 },
        oldestOpenAt: { critical: "2026-09-20T10:00:00.000Z", high: "2026-10-30T10:00:00.000Z" },
      },
      codeScanning: { open: { high: 1 } },
      secretScanning: { enabled: true, open: 1, oldestOpenAt: "2026-11-10T10:00:00.000Z" },
    });
    expect(clean.payload).toMatchObject({
      dependabot: { open: { critical: 0, high: 0 } },
      secretScanning: { enabled: true, open: 0, oldestOpenAt: null },
    });
    expect(partial.payload).toMatchObject({
      dependabot: { open: { low: 1, medium: 0 } },
      codeScanning: { open: { critical: 1 } },
      secretScanning: { enabled: false, open: null },
    });
    expectWhitelisted(
      [first, clean, partial],
      ["dependabot", "codeScanning", "secretScanning", "takenAt"],
    );
  });
});

describe("aiguillage des webhooks", () => {
  it("par type d'événement et action ; les autres ne donnent rien", () => {
    const pr = fixtures("pull_request")[0]!;
    expect(normalizeWebhook("pull_request", pr, ctx)).toHaveLength(1);
    expect(normalizeWebhook("pull_request", { ...pr, action: "opened" }, ctx)).toEqual([]);
    expect(normalizeWebhook("push", pr, ctx)).toEqual([]);
    expect(normalizeWebhook("release", fixtures("release")[0], ctx)).toHaveLength(1);
    expect(normalizeWebhook("workflow_run", fixtures("workflow_run")[0], ctx)).toHaveLength(1);
    expect(
      normalizeWebhook("pull_request_review", fixtures("pull_request_review")[0], ctx),
    ).toHaveLength(1);
    expect(normalizeWebhook("ping", null, ctx)).toEqual([]);
  });
});
