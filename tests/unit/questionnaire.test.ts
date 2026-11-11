// PL-203 — Questionnaire : plafond de 12 questions, branchements, retour arrière, reprise, et cohérence avec le
// moteur : pour chaque cas de cases.ts, le chemin du questionnaire produit la même catégorie et le même rôle.
import { describe, expect, it } from "vitest";
import type { Answers } from "@/server/classify/answers";
import { CASES } from "@/server/classify/cases";
import { classify } from "@/server/classify/engine";
import {
  FIRST_QUESTION,
  QUESTIONS,
  QUESTION_IDS,
  isComplete,
  isValidResponse,
  nextQuestion,
  pathOf,
  pruneResponses,
  toAnswers,
  type QuestionId,
  type Responses,
} from "@/server/classify/questionnaire";

/** Répond au questionnaire comme le ferait l'auteur de ces réponses, en suivant les branchements. */
function respond(a: Answers): Responses {
  const all: Required<Responses> = {
    aiSystem: a.isAiSystem,
    scope: a.inScope ? [] : ["military"],
    prohibited: a.prohibitedPractices,
    annexI: a.annexISafetyComponent,
    annexIII: a.annexIIIPoints,
    profiling: a.performsProfiling,
    art63: a.art63Conditions,
    transparency: [
      ...(a.interactsWithPersons ? ["interactsWithPersons"] : []),
      ...(a.generatesSyntheticContent ? ["generatesSyntheticContent"] : []),
    ],
    developer: a.developsSystem,
    art25: [
      ...(a.ownBrand ? ["ownBrand"] : []),
      ...(a.substantialModification ? ["substantialModification"] : []),
      ...(a.changedPurpose ? ["changedPurpose"] : []),
    ],
  };
  const responses: Responses = {};
  let id: QuestionId | null = FIRST_QUESTION;
  while (id) {
    responses[id] = all[id];
    id = nextQuestion(id, responses);
  }
  return responses;
}

/** Tous les chemins possibles : chaque question prend une réponse « oui/une option » ou « non/aucune ». */
function allPaths(): QuestionId[][] {
  const paths: QuestionId[][] = [];
  const walk = (id: QuestionId | null, responses: Responses, path: QuestionId[]) => {
    if (!id) return void paths.push(path);
    const q = QUESTIONS[id];
    const choices = q.kind === "yesNo" ? [true, false] : [[], [q.options![0]!]];
    for (const choice of choices) {
      const next = { ...responses, [id]: choice };
      walk(nextQuestion(id, next), next, [...path, id]);
    }
  };
  walk(FIRST_QUESTION, {}, []);
  return paths;
}

describe("questionnaire", () => {
  it("ne pose jamais plus de 12 questions, une seule fois chacune", () => {
    const paths = allPaths();
    expect(paths.length).toBeGreaterThan(10);
    for (const path of paths) {
      expect(path.length).toBeLessThanOrEqual(12);
      expect(new Set(path).size).toBe(path.length);
    }
    expect(Math.max(...paths.map((p) => p.length))).toBe(9);
  });

  it("chaque question est atteignable et porte son article", () => {
    const reached = new Set(allPaths().flat());
    expect([...reached].sort()).toEqual([...QUESTION_IDS].sort());
    for (const id of QUESTION_IDS) expect(QUESTIONS[id].articleRef).toMatch(/^Art\. /u);
  });

  describe.each(CASES)("$name", ({ answers }) => {
    it("le questionnaire aboutit au même résultat que le moteur", () => {
      const responses = respond(answers);
      expect(isComplete(responses)).toBe(true);
      const expected = classify(answers);
      const actual = classify(toAnswers(responses));
      expect([actual.tier, actual.role, actual.annexIIIPoints]).toEqual([
        expected.tier,
        expected.role,
        expected.annexIIIPoints,
      ]);
      // Avec profilage, l'arbre du §3.2 E1 ne pose pas la question de l'Art. 6(3) : aucune condition recueillie.
      expect(actual.art63Conditions).toEqual(
        expected.involvesProfiling ? [] : expected.art63Conditions,
      );
    });
  });

  it("reprise : le chemin s'arrête à la première question sans réponse", () => {
    expect(pathOf({})).toEqual({ answered: [], current: "aiSystem", estimatedLength: 8 });
    const responses: Responses = { aiSystem: true, scope: [], prohibited: [], annexI: false };
    const path = pathOf(responses);
    expect(path.answered).toEqual(["aiSystem", "scope", "prohibited", "annexI"]);
    expect(path.current).toBe("annexIII");
    expect(path.estimatedLength).toBe(8);
    expect(pathOf({ ...responses, annexIII: ["4(a)"] }).estimatedLength).toBe(9);
    expect(isComplete(responses)).toBe(false);
    expect(() => toAnswers(responses)).toThrow("Questionnaire incomplet");
  });

  it("retour arrière : changer une réponse écarte la branche abandonnée", () => {
    const responses: Responses = {
      aiSystem: true,
      scope: [],
      prohibited: [],
      annexI: false,
      annexIII: ["4(a)"],
      profiling: false,
      art63: ["a"],
      developer: true,
    };
    expect(classify(toAnswers(responses)).tier).toBe("HIGH_RISK_EXEMPT_ART6_3");
    // Retour à la question de l'Annexe III : plus aucun point coché.
    const changed = pruneResponses({ ...responses, annexIII: [] });
    expect(changed).toEqual({
      aiSystem: true,
      scope: [],
      prohibited: [],
      annexI: false,
      annexIII: [],
    });
    expect(pathOf(changed).current).toBe("transparency");
  });

  it("valide les réponses selon le type de la question", () => {
    expect(isValidResponse("aiSystem", true)).toBe(true);
    expect(isValidResponse("aiSystem", ["a"])).toBe(false);
    expect(isValidResponse("annexIII", ["4(a)", "5(b)"])).toBe(true);
    expect(isValidResponse("annexIII", [])).toBe(true);
    expect(isValidResponse("annexIII", ["9(z)"])).toBe(false);
    expect(isValidResponse("annexIII", ["4(a)", "4(a)"])).toBe(false);
    expect(isValidResponse("annexIII", "4(a)")).toBe(false);
    expect(isValidResponse("art25", [3])).toBe(false);
  });
});
