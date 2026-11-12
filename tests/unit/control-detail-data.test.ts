// PL-407 — Détail d'un contrôle, fonctions pures : frise de 12 semaines, preuves fautives en tête, preuve attendue,
// lien vers la source (https seulement), relecture des raisons.
import { describe, expect, it } from "vitest";
import {
  expectedEvidence,
  faultyEvidenceIds,
  orderEvidence,
  parseReasons,
  safeSourceUrl,
  weeklyHistory,
  weekStart,
} from "@/server/services/control-detail-data";

const now = new Date("2026-11-12T12:00:00Z"); // jeudi
const DAY = 86_400_000;
const reason = (evidenceIds: string[]) => ({
  code: "X",
  message: { fr: "x", en: "x" },
  evidenceIds,
});

describe("frise d'historique", () => {
  it("semaines commençant le lundi UTC", () => {
    expect(weekStart(now).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(weekStart(new Date("2026-11-09T00:00:00Z")).toISOString()).toBe(
      "2026-11-09T00:00:00.000Z",
    );
    expect(weekStart(new Date("2026-11-15T23:59:00Z")).toISOString()).toBe(
      "2026-11-09T00:00:00.000Z",
    );
  });

  it("12 semaines, la courante en dernier ; dernier statut de chaque semaine ; null sans évaluation", () => {
    const history = weeklyHistory(
      [
        { status: "FAIL", evaluatedAt: new Date(now.getTime() - DAY) },
        { status: "PASS", evaluatedAt: new Date(now.getTime() - 2 * DAY) },
        { status: "PASS", evaluatedAt: new Date(now.getTime() - 14 * DAY) },
        { status: "FAIL", evaluatedAt: new Date(now.getTime() - 400 * DAY) },
      ],
      now,
    );
    expect(history).toHaveLength(12);
    expect(history.at(-1)).toEqual({ week: "2026-11-09", status: "FAIL" });
    expect(history.at(-2)!.status).toBeNull();
    expect(history.at(-3)!.status).toBe("PASS");
    expect(history[0]!.week).toBe("2026-08-24");
    expect(history.filter((h) => h.status !== null)).toHaveLength(2);
  });
});

describe("preuves fautives en tête", () => {
  const items = [
    { id: "ev_a", occurredAt: new Date(now.getTime() - DAY) },
    { id: "ev_b", occurredAt: new Date(now.getTime() - 3 * DAY) },
    { id: "ev_c", occurredAt: new Date(now.getTime() - 2 * DAY) },
  ];

  it("échec, partiel ou périmé : les preuves citées par les raisons sont fautives", () => {
    const faulty = faultyEvidenceIds({ status: "FAIL", reasons: [reason(["ev_b"])] });
    expect([...faulty]).toEqual(["ev_b"]);
    expect(orderEvidence(items, faulty).map((e) => [e.id, e.faulty])).toEqual([
      ["ev_b", true],
      ["ev_a", false],
      ["ev_c", false],
    ]);
    expect(faultyEvidenceIds({ status: "STALE", reasons: [reason(["ev_a"])] }).size).toBe(1);
  });

  it("succès ou aucune évaluation : rien n'est fautif, les plus récentes d'abord", () => {
    expect(faultyEvidenceIds({ status: "PASS", reasons: [reason(["ev_b"])] }).size).toBe(0);
    expect(faultyEvidenceIds(null).size).toBe(0);
    expect(orderEvidence(items, new Set()).map((e) => e.id)).toEqual(["ev_a", "ev_c", "ev_b"]);
  });
});

describe("preuve attendue (contrôle sans preuve)", () => {
  it("document du dépôt : chemin de la convention docs/ai, GitHub, dépôt manuel accepté", () => {
    expect(
      expectedEvidence({
        evidenceKinds: ["github.file.snapshot", "manual.upload"],
        evaluatorKey: "document.presentAndFresh",
        freshnessDays: 365,
        params: { path: "docs/ai/instructions-for-use.md" },
      }),
    ).toEqual({
      kinds: ["github.file.snapshot", "manual.upload"],
      path: "docs/ai/instructions-for-use.md",
      freshnessDays: 365,
      connector: "GITHUB",
      jiraPurpose: null,
      manual: true,
    });
  });

  it("Jira : finalité de la correspondance à déclarer", () => {
    const e = expectedEvidence({
      evidenceKinds: ["jira.issue.snapshot"],
      evaluatorKey: "jira.seriousIncidentNotified",
      freshnessDays: null,
      params: {},
    });
    expect(e).toMatchObject({
      connector: "JIRA",
      jiraPurpose: "incidents",
      manual: false,
      path: null,
    });
  });
});

describe("lien vers la source", () => {
  it("https seulement", () => {
    expect(safeSourceUrl("https://github.com/o/r/pull/1")).toBe("https://github.com/o/r/pull/1");
    expect(safeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(safeSourceUrl("http://example.com")).toBeNull();
    expect(safeSourceUrl("pas une adresse")).toBeNull();
    expect(safeSourceUrl(null)).toBeNull();
  });
});

describe("raisons relues sans confiance", () => {
  it("entrées mal formées écartées, identifiants non textuels filtrés", () => {
    expect(
      parseReasons([
        { code: "A", message: { fr: "a", en: "a" }, evidenceIds: ["ev_1", 2] },
        { code: "B", message: { fr: "b" } },
        null,
        "x",
      ]),
    ).toEqual([{ code: "A", message: { fr: "a", en: "a" }, evidenceIds: ["ev_1"] }]);
    expect(parseReasons({})).toEqual([]);
  });
});
