// PL-202 — Moteur de classification : les cas nommés de src/server/classify/cases.ts, la trace de raisonnement,
// le déterminisme et la validation des entrées. Couverture de branches à 100 % exigée (pnpm test:classify).
import { describe, expect, it } from "vitest";
import { CASES } from "@/server/classify/cases";
import {
  CURRENT_RULESET,
  classify,
  type ReasoningStep,
  UnknownRulesetError,
} from "@/server/classify/engine";

const RULE_ORDER = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"];

describe("jeu de cas", () => {
  it("compte au moins 60 cas, aux noms uniques, dont les exemples des lignes directrices", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(CASES.map((c) => c.name)).size).toBe(CASES.length);
    const guidelines = CASES.filter((c) => c.source === "LD").map((c) => c.name);
    for (const example of [
      "Analyseur de CV",
      "Planification d'entretiens",
      "classement de candidatures",
      "Affectation de tâches selon les traits personnels",
      "Score de crédit",
      "Détection de fraude financière",
    ]) {
      expect(
        guidelines.some((name) => name.includes(example)),
        example,
      ).toBe(true);
    }
  });

  it("couvre chaque règle de catégorie et chaque issue de rôle", () => {
    expect(new Set(CASES.map((c) => c.expected.decidedBy))).toEqual(new Set(RULE_ORDER));
    expect(new Set(CASES.map((c) => c.expected.role))).toEqual(new Set(["PROVIDER", "DEPLOYER"]));
  });
});

describe.each(CASES)("$name", ({ answers, expected, reference }) => {
  const result = classify(answers);

  it(`${expected.tier} (${reference})`, () => {
    expect({
      tier: result.tier,
      role: result.role,
      annexIIIPoints: result.annexIIIPoints,
      art63Conditions: result.art63Conditions,
      involvesProfiling: result.involvesProfiling,
    }).toEqual({
      tier: expected.tier,
      role: expected.role,
      annexIIIPoints: expected.annexIIIPoints,
      art63Conditions: expected.art63Conditions,
      involvesProfiling: expected.involvesProfiling,
    });
  });

  it(`trace : règles évaluées jusqu'à ${expected.decidedBy}, qui conclut`, () => {
    const tierSteps = result.reasoning.filter((s) => /^R\d$/u.test(s.ruleId));
    const evaluated = RULE_ORDER.slice(0, RULE_ORDER.indexOf(expected.decidedBy) + 1);
    expect(tierSteps.map((s) => s.ruleId)).toEqual(evaluated);
    expect(tierSteps.at(-1)?.outcome).toBe(expected.tier);
    for (const step of tierSteps.slice(0, -1)) expect(step.outcome).toBe("CONTINUE");
    const roleSteps = result.reasoning.filter((s) => s.ruleId.startsWith("ROLE"));
    expect(roleSteps.at(-1)?.outcome).toBe(expected.role);
    for (const step of result.reasoning) expect(step.articleRef).not.toBe("");
  });
});

describe("règles transversales", () => {
  const annexIII = CASES.find(
    (c) => c.name === "Appariement et classement de candidatures",
  )!.answers;

  it("le profilage force HIGH_RISK quelles que soient les conditions de l'Art. 6(3)", () => {
    for (const conditions of [[], ["a"], ["b"], ["c"], ["d"], ["a", "b", "c", "d"]] as const) {
      const result = classify({ ...annexIII, art63Conditions: [...conditions] });
      expect(result.tier).toBe("HIGH_RISK");
      expect(result.reasoning.find((s) => s.ruleId === "R5")).toMatchObject({
        answerKey: "performsProfiling",
        articleRef: "Art. 6(3), dernier alinéa",
        outcome: "HIGH_RISK",
      });
    }
  });

  it("chaque critère de l'Art. 25(1) fait basculer un déployeur en fournisseur", () => {
    const deployer = { ...annexIII, developsSystem: false };
    expect(classify(deployer).role).toBe("DEPLOYER");
    for (const [key, ruleId, articleRef] of [
      ["ownBrand", "ROLE2", "Art. 25(1)(a)"],
      ["substantialModification", "ROLE3", "Art. 25(1)(b)"],
      ["changedPurpose", "ROLE4", "Art. 25(1)(c)"],
    ] as const) {
      const result = classify({ ...deployer, [key]: true });
      expect(result.role).toBe("PROVIDER");
      expect(result.reasoning.at(-1)).toEqual<ReasoningStep>({
        ruleId,
        answerKey: key,
        articleRef,
        outcome: "PROVIDER",
      });
    }
  });

  it("est déterministe et ne modifie pas les réponses", () => {
    for (const { answers } of CASES) {
      const frozen = structuredClone(answers);
      expect(classify(answers)).toEqual(classify(structuredClone(answers)));
      expect(answers).toEqual(frozen);
    }
  });

  it("porte la version des règles et refuse une version inconnue", () => {
    expect(CURRENT_RULESET).toBe("2026.11.0");
    expect(classify(annexIII).rulesetVersion).toBe("2026.11.0");
    expect(classify(annexIII, "2026.11.0").tier).toBe("HIGH_RISK");
    expect(() => classify(annexIII, "2025.1.0")).toThrow(UnknownRulesetError);
  });

  it("rejette des réponses invalides avant toute règle", () => {
    expect(() => classify({ ...annexIII, annexIIIPoints: ["9(z)"] } as never)).toThrow();
    expect(() => classify({ ...annexIII, unexpected: true } as never)).toThrow();
    expect(() => classify({} as never)).toThrow();
  });
});
