// Moteur de classification de l'AI Act (PL-202, §3.2 E1, prompt-type du §9.4). Fonction pure : aucun accès réseau
// ni base, aucune date système, aucun aléa, aucun modèle (règles 4 et 5 de CLAUDE.md). Une même série de réponses
// avec une même version de règles produit toujours le même résultat.
//
// Catégorie, dans cet ordre, la première règle qui conclut s'arrête ; chaque règle évaluée est tracée :
//  R1 !isAiSystem → NOT_AI_SYSTEM            R6 Annexe III sans condition de l'Art. 6(3) → HIGH_RISK
//  R2 !inScope → OUT_OF_SCOPE                R7 Annexe III avec condition → HIGH_RISK_EXEMPT_ART6_3
//  R3 pratique de l'Art. 5 → PROHIBITED      R8 interaction ou contenu synthétique → LIMITED_TRANSPARENCY
//  R4 composant Annexe I → HIGH_RISK         R9 sinon → MINIMAL
//  R5 Annexe III et profilage → HIGH_RISK, quelle que soit la condition de l'Art. 6(3)
// Rôle : PROVIDER si le système est développé par l'entreprise (Art. 3(3)) ou si l'un des critères de l'Art. 25(1)
// est rempli (marque propre, modification substantielle, changement de finalité) ; sinon DEPLOYER (Art. 3(4)).
import type { AiActRole, RiskTier } from "@/generated/prisma/enums";
import {
  ANNEX_III_POINTS,
  ART_6_3_CONDITIONS,
  answersSchema,
  type AnswerKey,
  type Answers,
  type AnnexIIIPoint,
  type Art63Condition,
} from "./answers";

export const CURRENT_RULESET = "2026.11.0";
const SUPPORTED_RULESETS: readonly string[] = [CURRENT_RULESET];

export type ClassifiedTier = Exclude<RiskTier, "UNCLASSIFIED">;
export type ClassifiedRole = Extract<AiActRole, "PROVIDER" | "DEPLOYER">;

/** Étape de la trace : règle, réponse qui l'a décidée, article, issue (« CONTINUE » si la règle ne conclut pas). */
export interface ReasoningStep {
  ruleId: string;
  answerKey: AnswerKey | null;
  articleRef: string;
  outcome: ClassifiedTier | ClassifiedRole | "CONTINUE";
}

export interface ClassificationResult {
  rulesetVersion: string;
  tier: ClassifiedTier;
  role: ClassifiedRole;
  /** Points de l'Annexe III retenus : renseignés seulement quand la catégorie en découle (R5 à R7). */
  annexIIIPoints: AnnexIIIPoint[];
  /** Conditions de l'Art. 6(3) déclarées, restituées quand la branche de l'Annexe III est atteinte. */
  art63Conditions: Art63Condition[];
  involvesProfiling: boolean;
  reasoning: ReasoningStep[];
}

export class UnknownRulesetError extends Error {
  constructor(readonly ruleset: string) {
    super(`Version de règles inconnue : ${ruleset}`);
    this.name = "UnknownRulesetError";
  }
}

/** Valeurs distinctes, dans l'ordre du texte (Annexe III, Art. 6(3)). */
function inTextOrder<T extends string>(values: readonly T[], order: readonly T[]): T[] {
  return order.filter((v) => values.includes(v));
}

function tierOf(a: Answers, trace: ReasoningStep[]) {
  const step = (
    ruleId: string,
    answerKey: AnswerKey | null,
    articleRef: string,
    outcome: ClassifiedTier | null,
  ) => {
    trace.push({ ruleId, answerKey, articleRef, outcome: outcome ?? "CONTINUE" });
    return outcome;
  };
  const none = { annexIIIPoints: [], art63Conditions: [], involvesProfiling: false };

  if (
    step("R1", "isAiSystem", "Art. 3(1), considérant 12", a.isAiSystem ? null : "NOT_AI_SYSTEM")
  ) {
    return { tier: "NOT_AI_SYSTEM" as const, ...none };
  }
  if (step("R2", "inScope", "Art. 2", a.inScope ? null : "OUT_OF_SCOPE")) {
    return { tier: "OUT_OF_SCOPE" as const, ...none };
  }
  if (
    step(
      "R3",
      "prohibitedPractices",
      "Art. 5",
      a.prohibitedPractices.length > 0 ? "PROHIBITED" : null,
    )
  ) {
    return { tier: "PROHIBITED" as const, ...none };
  }
  if (
    step("R4", "annexISafetyComponent", "Art. 6(1)", a.annexISafetyComponent ? "HIGH_RISK" : null)
  ) {
    return { tier: "HIGH_RISK" as const, ...none };
  }

  const points = inTextOrder(a.annexIIIPoints, ANNEX_III_POINTS);
  const conditions = inTextOrder(a.art63Conditions, ART_6_3_CONDITIONS);
  if (points.length > 0) {
    const annex = { annexIIIPoints: points, art63Conditions: conditions };
    if (
      step(
        "R5",
        "performsProfiling",
        "Art. 6(3), dernier alinéa",
        a.performsProfiling ? "HIGH_RISK" : null,
      )
    ) {
      return { tier: "HIGH_RISK" as const, ...annex, involvesProfiling: true };
    }
    const tier: ClassifiedTier = conditions.length === 0 ? "HIGH_RISK" : "HIGH_RISK_EXEMPT_ART6_3";
    step("R6", "art63Conditions", "Art. 6(2)", conditions.length === 0 ? tier : null);
    if (conditions.length > 0) step("R7", "art63Conditions", "Art. 6(3) et 6(4)", tier);
    return { tier, ...annex, involvesProfiling: false };
  }
  for (const [ruleId, articleRef] of [
    ["R5", "Art. 6(3), dernier alinéa"],
    ["R6", "Art. 6(2)"],
    ["R7", "Art. 6(3) et 6(4)"],
  ] as const) {
    step(ruleId, "annexIIIPoints", articleRef, null);
  }

  const transparencyKey = a.interactsWithPersons
    ? "interactsWithPersons"
    : a.generatesSyntheticContent
      ? "generatesSyntheticContent"
      : null;
  if (
    step(
      "R8",
      transparencyKey ?? "interactsWithPersons",
      "Art. 50",
      transparencyKey ? "LIMITED_TRANSPARENCY" : null,
    )
  ) {
    return { tier: "LIMITED_TRANSPARENCY" as const, ...none };
  }
  step("R9", null, "Art. 5, 6 et 50 non applicables", "MINIMAL");
  return { tier: "MINIMAL" as const, ...none };
}

const ROLE_RULES = [
  ["ROLE1", "developsSystem", "Art. 3(3)"],
  ["ROLE2", "ownBrand", "Art. 25(1)(a)"],
  ["ROLE3", "substantialModification", "Art. 25(1)(b)"],
  ["ROLE4", "changedPurpose", "Art. 25(1)(c)"],
] as const;

function roleOf(a: Answers, trace: ReasoningStep[]): ClassifiedRole {
  for (const [ruleId, answerKey, articleRef] of ROLE_RULES) {
    const provider = a[answerKey];
    trace.push({ ruleId, answerKey, articleRef, outcome: provider ? "PROVIDER" : "CONTINUE" });
    if (provider) return "PROVIDER";
  }
  trace.push({ ruleId: "ROLE5", answerKey: null, articleRef: "Art. 3(4)", outcome: "DEPLOYER" });
  return "DEPLOYER";
}

export function classify(
  answers: Answers,
  ruleset: string = CURRENT_RULESET,
): ClassificationResult {
  if (!SUPPORTED_RULESETS.includes(ruleset)) throw new UnknownRulesetError(ruleset);
  const a = answersSchema.parse(answers);
  const reasoning: ReasoningStep[] = [];
  const decision = tierOf(a, reasoning);
  const role = roleOf(a, reasoning);
  return { rulesetVersion: ruleset, ...decision, role, reasoning };
}
