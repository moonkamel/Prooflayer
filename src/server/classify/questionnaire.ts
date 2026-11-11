// Questionnaire de classification (PL-203, §3.2 E1, §5.1 étape 3). Fonctions pures : définition des questions,
// branchements, chemin parcouru et conversion en réponses du moteur (answers.ts). Les textes (question, « Pourquoi
// cette question ? », deux exemples, options) sont dans messages/{fr,en}.json, espace `questionnaire`.
//
// Une question par écran, 10 au plus sur un chemin (plafond du §3.2 E1 : 12). Les branchements suivent l'ordre des
// règles du moteur : dès qu'une règle de catégorie conclurait, le questionnaire passe aux questions de rôle.
import {
  ANNEX_III_POINTS,
  ART_6_3_CONDITIONS,
  PROHIBITED_PRACTICES,
  answersSchema,
  type Answers,
} from "./answers";

export const QUESTION_IDS = [
  "aiSystem",
  "scope",
  "prohibited",
  "annexI",
  "annexIII",
  "profiling",
  "art63",
  "transparency",
  "developer",
  "art25",
] as const;
export type QuestionId = (typeof QUESTION_IDS)[number];

/** Exclusions de l'Art. 2 proposées (une seule suffit pour sortir du champ). */
export const SCOPE_EXCLUSIONS = [
  "military",
  "research",
  "testing",
  "personal",
  "thirdCountry",
] as const;
export const TRANSPARENCY_OPTIONS = ["interactsWithPersons", "generatesSyntheticContent"] as const;
export const ART_25_OPTIONS = ["ownBrand", "substantialModification", "changedPurpose"] as const;

export type QuestionKind = "yesNo" | "multi";

export interface QuestionDefinition {
  id: QuestionId;
  kind: QuestionKind;
  /** Article concerné, affiché sous la question. */
  articleRef: string;
  /** Options d'une question à choix multiples ; « aucune » est toujours proposée en plus. */
  options?: readonly string[];
}

export const QUESTIONS: Record<QuestionId, QuestionDefinition> = {
  aiSystem: { id: "aiSystem", kind: "yesNo", articleRef: "Art. 3(1)" },
  scope: { id: "scope", kind: "multi", articleRef: "Art. 2", options: SCOPE_EXCLUSIONS },
  prohibited: {
    id: "prohibited",
    kind: "multi",
    articleRef: "Art. 5(1)",
    options: PROHIBITED_PRACTICES,
  },
  annexI: { id: "annexI", kind: "yesNo", articleRef: "Art. 6(1), Annexe I" },
  annexIII: {
    id: "annexIII",
    kind: "multi",
    articleRef: "Art. 6(2), Annexe III",
    options: ANNEX_III_POINTS,
  },
  profiling: { id: "profiling", kind: "yesNo", articleRef: "Art. 6(3), dernier alinéa" },
  art63: { id: "art63", kind: "multi", articleRef: "Art. 6(3)", options: ART_6_3_CONDITIONS },
  transparency: {
    id: "transparency",
    kind: "multi",
    articleRef: "Art. 50",
    options: TRANSPARENCY_OPTIONS,
  },
  developer: { id: "developer", kind: "yesNo", articleRef: "Art. 3(3)" },
  art25: { id: "art25", kind: "multi", articleRef: "Art. 25(1)", options: ART_25_OPTIONS },
};

/** Réponse à une question : oui/non, ou options cochées (tableau vide = « aucune »). */
export type Response = boolean | string[];
export type Responses = Partial<Record<QuestionId, Response>>;

export const FIRST_QUESTION: QuestionId = "aiSystem";

const isYes = (r: Response | undefined) => r === true;
const hasAny = (r: Response | undefined) => Array.isArray(r) && r.length > 0;

/** Question suivante après `id`, selon sa réponse ; `null` : fin du questionnaire. */
export function nextQuestion(id: QuestionId, responses: Responses): QuestionId | null {
  const r = responses[id];
  switch (id) {
    case "aiSystem":
      return isYes(r) ? "scope" : "developer";
    case "scope":
      return hasAny(r) ? "developer" : "prohibited";
    case "prohibited":
      return hasAny(r) ? "developer" : "annexI";
    case "annexI":
      return isYes(r) ? "developer" : "annexIII";
    case "annexIII":
      return hasAny(r) ? "profiling" : "transparency";
    case "profiling":
      return isYes(r) ? "developer" : "art63";
    case "art63":
    case "transparency":
      return "developer";
    case "developer":
      return isYes(r) ? null : "art25";
    case "art25":
      return null;
  }
}

/** Valeur supposée d'une question sans réponse, pour estimer la longueur du chemin : la réponse la plus courante
 * (un système d'IA, sans exclusion ni pratique interdite, etc.). */
const assumedResponse = (id: QuestionId): Response =>
  id === "aiSystem" ? true : QUESTIONS[id].kind === "yesNo" ? false : [];

/**
 * Chemin du questionnaire : questions déjà répondues dans l'ordre des branchements, puis la première sans réponse.
 * `estimated` prolonge le chemin jusqu'à la fin en supposant « non » ou « aucune » pour les questions à venir.
 */
export function pathOf(responses: Responses): {
  answered: QuestionId[];
  current: QuestionId | null;
  estimatedLength: number;
} {
  const answered: QuestionId[] = [];
  let id: QuestionId | null = FIRST_QUESTION;
  while (id && responses[id] !== undefined) {
    answered.push(id);
    id = nextQuestion(id, responses);
  }
  const current = id;
  let length = answered.length;
  const assumed: Responses = { ...responses };
  while (id) {
    length += 1;
    assumed[id] = assumedResponse(id);
    id = nextQuestion(id, assumed);
  }
  return { answered, current, estimatedLength: length };
}

/** Réponses hors du chemin (branche abandonnée après un retour arrière) : retirées. */
export function pruneResponses(responses: Responses): Responses {
  const { answered } = pathOf(responses);
  return Object.fromEntries(answered.map((id) => [id, responses[id]])) as Responses;
}

/** Valide une réponse à une question : type attendu, options connues, sans doublon. */
export function isValidResponse(id: QuestionId, value: unknown): value is Response {
  const question = QUESTIONS[id];
  if (question.kind === "yesNo") return typeof value === "boolean";
  return (
    Array.isArray(value) &&
    new Set(value).size === value.length &&
    value.every((v) => typeof v === "string" && (question.options as readonly string[]).includes(v))
  );
}

export function isComplete(responses: Responses): boolean {
  return pathOf(responses).current === null;
}

const selected = (r: Response | undefined, option: string) =>
  Array.isArray(r) && r.includes(option);

/**
 * Réponses du moteur. Une question hors du chemin prend la valeur neutre (« non », « aucune ») : le moteur ne la
 * lit pas, puisque la règle qui précède a conclu (les branchements suivent l'ordre R1 à R9).
 */
export function toAnswers(responses: Responses): Answers {
  if (!isComplete(responses)) throw new Error("Questionnaire incomplet");
  const r = pruneResponses(responses);
  const list = (id: QuestionId) => (Array.isArray(r[id]) ? (r[id] as string[]) : []);
  return answersSchema.parse({
    isAiSystem: isYes(r.aiSystem),
    inScope: !hasAny(r.scope),
    prohibitedPractices: list("prohibited"),
    annexISafetyComponent: isYes(r.annexI),
    annexIIIPoints: list("annexIII"),
    performsProfiling: isYes(r.profiling),
    art63Conditions: list("art63"),
    interactsWithPersons: selected(r.transparency, "interactsWithPersons"),
    generatesSyntheticContent: selected(r.transparency, "generatesSyntheticContent"),
    developsSystem: isYes(r.developer),
    ownBrand: selected(r.art25, "ownBrand"),
    substantialModification: selected(r.art25, "substantialModification"),
    changedPurpose: selected(r.art25, "changedPurpose"),
  });
}
