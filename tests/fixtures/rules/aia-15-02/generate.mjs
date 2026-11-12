// Génère les jeux figés d'AIA-15-02 (PL-402) : node tests/fixtures/rules/aia-15-02/generate.mjs tests/fixtures/rules/aia-15-02
import { writeFileSync } from "node:fs";
const out = process.argv[2];
const NOW = new Date("2026-11-12T12:00:00.000Z");
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
const devs = ["amina", "bastien", "chloe", "dario", "elise"];
let n = 0;
const id = (p) => `ev_${p}_${String(++n).padStart(4, "0")}`;
function pr(number, author, mergedMs, resourceId = "res_scoring_api") {
  return {
    id: id("pr"),
    kind: "github.pull_request.merged",
    resourceId,
    occurredAt: iso(mergedMs),
    capturedAt: iso(mergedMs + 5000),
    payload: {
      number,
      title: `Changement ${number}`,
      baseRef: "main",
      headSha: `h${number}`,
      mergeCommitSha: `m${number}`,
      mergedAt: iso(mergedMs),
      author,
      mergedBy: author,
      changedFiles: 3,
      labels: [],
      draft: false,
    },
    declarative: false,
    validUntil: null,
    linkedByUser: false,
  };
}
function review(number, reviewer, pullAuthor, state, atMs, resourceId = "res_scoring_api") {
  return {
    id: id("rv"),
    kind: "github.review.submitted",
    resourceId,
    occurredAt: iso(atMs),
    capturedAt: iso(atMs + 5000),
    payload: {
      pullNumber: number,
      reviewId: 9000 + n,
      state,
      reviewer,
      pullAuthor,
      commitId: `h${number}`,
      submittedAt: iso(atMs),
    },
    declarative: false,
    validUntil: null,
    linkedByUser: false,
  };
}
function reviewed(count, opts = {}) {
  const ev = [];
  for (let i = 1; i <= count; i++) {
    const author = opts.author?.(i) ?? devs[i % devs.length];
    const merged = NOW.getTime() - (i % 85) * DAY - i * 60_000;
    ev.push(pr(i, author, merged));
    const reviewer = devs[(i + 1) % devs.length];
    ev.push(
      review(
        i,
        opts.reviewer?.(i, author) ?? reviewer,
        author,
        "APPROVED",
        opts.reviewAt?.(i, merged) ?? merged - 3600_000,
      ),
    );
    if (i % 7 === 0) ev.push(review(i, reviewer, author, "COMMENTED", merged - 7200_000));
  }
  return ev;
}
const write = (name, evidence, description) =>
  writeFileSync(
    `${out}/${name}.json`,
    JSON.stringify(
      {
        description,
        now: NOW.toISOString(),
        params: { windowDays: 90, minApprovals: 1 },
        evidence,
      },
      null,
      2,
    ) + "\n",
  );

n = 0;
write(
  "success-87",
  reviewed(87),
  "87 PR fusionnées sur 90 jours, chacune approuvée par un relecteur distinct de l'auteur avant la fusion.",
);
n = 0;
write(
  "self-approved",
  reviewed(40, { reviewer: (i, author) => (i === 12 || i === 31 ? author : undefined) }),
  "40 PR, dont 2 (n° 12 et 31) approuvées par leur propre auteur.",
);
n = 0;
write(
  "approval-after-merge",
  reviewed(10, { reviewAt: (i, merged) => (i === 4 ? merged + 600_000 : merged - 3600_000) }),
  "10 PR ; la n° 4 n'est approuvée qu'après sa fusion.",
);
n = 0;
write("no-pr", [], "Aucune preuve de PR.");
n = 0;
{
  const ev = [];
  for (let i = 1; i <= 5; i++) {
    const m = NOW.getTime() - (120 + i) * DAY;
    ev.push(pr(i, "amina", m), review(i, "bastien", "amina", "APPROVED", m - 3600_000));
  }
  write(
    "old-prs-only",
    ev,
    "5 PR fusionnées il y a plus de 120 jours, aucune dans la fenêtre de 90 jours.",
  );
}
n = 0;
write(
  "bot-author",
  reviewed(6, {
    author: (i) => (i <= 3 ? "dependabot[bot]" : undefined),
    reviewer: (i) => (i === 2 ? "skip" : undefined),
  }).filter((e) => !(e.kind === "github.review.submitted" && e.payload.reviewer === "skip")),
  "6 PR dont 3 ouvertes par un robot ; la n° 2 du robot n'a aucune approbation.",
);
