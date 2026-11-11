// PL-204 — Explication d'une classification : lignes de la trace et implications de la catégorie.
import { describe, expect, it } from "vitest";
import { CASES } from "@/server/classify/cases";
import { classify } from "@/server/classify/engine";
import { implicationsOf, traceLines } from "@/server/classify/explain";

const byName = (name: string) => classify(CASES.find((c) => c.name.startsWith(name))!.answers);

describe("traceLines", () => {
  it("classement de candidatures : système d'IA, champ, Art. 5, Annexe I, profilage, rôle", () => {
    const lines = traceLines(byName("Appariement et classement").reasoning);
    expect(lines.map((l) => l.key)).toEqual([
      "R1.continue",
      "R2.continue",
      "R3.continue",
      "R4.continue",
      "R5.concludes",
      "ROLE1.concludes",
    ]);
    expect(lines[4]).toMatchObject({
      questionId: "profiling",
      articleRef: "Art. 6(3), dernier alinéa",
    });
  });

  it("sans point de l'Annexe III, R5 à R7 se résument en une ligne", () => {
    const lines = traceLines(byName("Filtre anti-spam").reasoning);
    expect(lines.map((l) => l.key)).toEqual([
      "R1.continue",
      "R2.continue",
      "R3.continue",
      "R4.continue",
      "noAnnexIII",
      "R8.continue",
      "R9.concludes",
      "ROLE1.concludes",
    ]);
    expect(lines.find((l) => l.key === "R9.concludes")?.questionId).toBeNull();
  });

  it("chaque ligne de chaque cas porte un article, et la règle par défaut du rôle n'a pas de question", () => {
    for (const c of CASES) {
      const lines = traceLines(classify(c.answers).reasoning);
      expect(lines.every((l) => l.articleRef.length > 0)).toBe(true);
      expect(lines.filter((l) => l.concludes)).toHaveLength(2);
    }
    const deployer = traceLines(byName("Banque qui utilise").reasoning);
    expect(deployer.at(-1)).toMatchObject({ key: "ROLE5.concludes", questionId: null });
    expect(deployer.at(-2)).toMatchObject({ key: "ROLE4.continue", questionId: "art25" });
  });
});

describe("implicationsOf", () => {
  it("Annexe III : 2 décembre 2027, contrôle interne (points 2 à 8) ou organisme notifié (point 1)", () => {
    expect(implicationsOf("HIGH_RISK", ["4(a)"])).toEqual({
      applicationDate: "2027-12-02",
      applicationRef: "Art. 113",
      assessment: "internalControl",
      assessmentRef: "Art. 43(2), Annexe VI",
    });
    expect(implicationsOf("HIGH_RISK", ["1(a)"]).assessment).toBe("notifiedBodyPossible");
  });

  it("Annexe I : 2 août 2028, procédure de la législation sectorielle", () => {
    expect(implicationsOf("HIGH_RISK", [])).toMatchObject({
      applicationDate: "2028-08-02",
      assessment: "sectoral",
    });
  });

  it("exemption, transparence, interdiction, et catégories sans obligation", () => {
    expect(implicationsOf("HIGH_RISK_EXEMPT_ART6_3", ["4(a)"]).applicationRef).toBe(
      "Art. 6(4), Art. 49(2)",
    );
    expect(implicationsOf("LIMITED_TRANSPARENCY", []).applicationDate).toBe("2026-08-02");
    expect(implicationsOf("PROHIBITED", []).applicationDate).toBe("2025-02-02");
    for (const tier of ["MINIMAL", "NOT_AI_SYSTEM", "OUT_OF_SCOPE"] as const) {
      expect(implicationsOf(tier, []).applicationDate).toBeNull();
    }
  });
});
