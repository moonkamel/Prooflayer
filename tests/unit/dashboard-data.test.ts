// PL-406 — Calculs du dashboard : décomptes, article de rattachement, courbe de couverture sur 90 jours.
import { describe, expect, it } from "vitest";
import {
  articleOf,
  articleOrder,
  connectorOf,
  countStatuses,
  coverageTimeline,
  dominantSource,
} from "@/server/services/dashboard-data";

const now = new Date("2026-11-12T15:00:00Z");
const daysAgo = (d: number, h = 12) => new Date(Date.UTC(2026, 10, 12 - d, h));

describe("décomptes", () => {
  it("couverture = PASS sur applicables ; non applicables écartés", () => {
    expect(
      countStatuses(["PASS", "PASS", "FAIL", "STALE", "MISSING", "PARTIAL", "NOT_APPLICABLE"]),
    ).toEqual({
      applicable: 6,
      pass: 2,
      fail: 1,
      partial: 1,
      stale: 1,
      missing: 1,
      notApplicable: 1,
    });
    expect(countStatuses([])).toMatchObject({ applicable: 0, pass: 0 });
  });
});

describe("article de rattachement", () => {
  it("regroupe par article, trie numériquement", () => {
    expect(articleOf("Art. 9(1)-(2)")).toBe("Art. 9");
    expect(articleOf("Art. 6(2), Annexe III")).toBe("Art. 6");
    expect(articleOf("Art. 4a")).toBe("Art. 4a");
    expect(
      ["Art. 15", "Art. 9", "Art. 4a", "Art. 4", "Art. 73"].sort(
        (a, b) => articleOrder(a) - articleOrder(b),
      ),
    ).toEqual(["Art. 4", "Art. 4a", "Art. 9", "Art. 15", "Art. 73"]);
  });
});

describe("courbe de couverture", () => {
  const instances = [
    { id: "a", createdAt: daysAgo(30), notApplicable: false },
    { id: "b", createdAt: daysAgo(30), notApplicable: false },
    { id: "c", createdAt: daysAgo(5), notApplicable: false },
    { id: "na", createdAt: daysAgo(30), notApplicable: true },
  ];
  const evaluations = [
    { controlInstanceId: "a", status: "PASS" as const, evaluatedAt: daysAgo(20) },
    { controlInstanceId: "a", status: "FAIL" as const, evaluatedAt: daysAgo(2) },
    { controlInstanceId: "b", status: "PASS" as const, evaluatedAt: daysAgo(10) },
    { controlInstanceId: "c", status: "PASS" as const, evaluatedAt: daysAgo(1) },
    { controlInstanceId: "na", status: "PASS" as const, evaluatedAt: daysAgo(10) },
  ];
  const points = coverageTimeline({ instances, evaluations }, now);
  const at = (d: number) => points[points.length - 1 - d]!;

  it("90 points, du plus ancien à aujourd'hui", () => {
    expect(points).toHaveLength(90);
    expect(points.at(-1)!.day).toBe("2026-11-12");
    expect(points[0]!.day).toBe("2026-08-15");
  });

  it("statut de la dernière évaluation à la fin de chaque jour ; contrôles ouverts seulement", () => {
    expect(at(40)).toMatchObject({ pass: 0, applicable: 0 });
    expect(at(25)).toMatchObject({ pass: 0, applicable: 2 });
    expect(at(15)).toMatchObject({ pass: 1, applicable: 2 });
    expect(at(8)).toMatchObject({ pass: 2, applicable: 2 });
    expect(at(3)).toMatchObject({ pass: 2, applicable: 3 });
    expect(at(0)).toMatchObject({ pass: 2, applicable: 3 });
  });

  it("une évaluation postérieure à maintenant n'est pas comptée", () => {
    const later = coverageTimeline(
      {
        instances,
        evaluations: [
          ...evaluations,
          {
            controlInstanceId: "a",
            status: "PASS",
            evaluatedAt: new Date(now.getTime() + 3600_000),
          },
        ],
      },
      now,
    );
    expect(later.at(-1)).toMatchObject({ pass: 2 });
  });
});

describe("source dominante et connecteur", () => {
  it("la plus nombreuse, puis l'ordre alphabétique", () => {
    expect(dominantSource({ GITHUB: 2, JIRA: 5 })).toBe("JIRA");
    expect(dominantSource({ JIRA: 2, GITHUB: 2 })).toBe("GITHUB");
    expect(dominantSource({})).toBeNull();
  });
  it("connecteur requis par un évaluateur", () => {
    expect(connectorOf("github.peerReview")).toBe("GITHUB");
    expect(connectorOf("jira.riskRegisterExists")).toBe("JIRA");
    expect(connectorOf("internal.packArchived")).toBeNull();
  });
});
