// Classification d'un système (PL-203, §3.2 E1, §4.4.2 routeur `classification`). Un brouillon par système :
// réponses enregistrées à chaque question (enregistrement automatique), reprise là où l'utilisateur s'est arrêté,
// calcul par le moteur pur (src/server/classify/engine.ts). La signature arrive avec PL-204.
import { CURRENT_RULESET, classify } from "@/server/classify/engine";
import {
  isValidResponse,
  pathOf,
  pruneResponses,
  toAnswers,
  type QuestionId,
  type Responses,
} from "@/server/classify/questionnaire";
import { audit, clientIp, type AuditAction } from "./audit";
import { ServiceError } from "./errors";
import type { OrgContext } from "./organization";

export const CLASSIFICATION_TARGET = "classification";

function dbOf(ctx: OrgContext) {
  if (!ctx.db) throw new Error("forOrg(orgId) requis");
  return ctx.db;
}

function record(
  ctx: OrgContext,
  action: AuditAction,
  id: string,
  metadata: Record<string, unknown>,
) {
  return audit(
    {
      orgId: ctx.orgId,
      actor: { type: "user", id: ctx.userId },
      ipAddress: clientIp(ctx.headers),
      db: ctx.db,
    },
    action,
    { type: CLASSIFICATION_TARGET, id },
    metadata,
  );
}

/** Réponses brutes stockées dans Classification.answers (§4.3.2). */
interface StoredAnswers {
  responses: Responses;
}
const responsesOf = (answers: unknown): Responses =>
  ((answers as Partial<StoredAnswers> | null)?.responses ?? {}) as Responses;

type DraftRow = NonNullable<
  Awaited<ReturnType<ReturnType<typeof dbOf>["classification"]["findFirst"]>>
>;

function view(row: DraftRow) {
  const responses = responsesOf(row.answers);
  const path = pathOf(responses);
  const computed = row.tier !== "UNCLASSIFIED";
  return {
    id: row.id,
    systemId: row.systemId,
    rulesetVersion: row.rulesetVersion,
    responses,
    answered: path.answered,
    current: path.current,
    estimatedLength: path.estimatedLength,
    result: computed
      ? {
          tier: row.tier,
          role: row.role,
          annexIIIPoints: row.annexIIIPoints,
          art63Conditions: row.art63Conditions,
          involvesProfiling: row.involvesProfiling,
          reasoning: row.reasoning,
        }
      : null,
  };
}

async function activeSystem(ctx: OrgContext, systemId: string) {
  const system = await dbOf(ctx).aiSystem.findFirst({ where: { id: systemId, orgId: ctx.orgId } });
  if (!system) throw new ServiceError("NOT_FOUND", "system.notFound");
  if (system.archivedAt) throw new ServiceError("CONFLICT", "system.archived");
  return system;
}

function findDraft(ctx: OrgContext, systemId: string) {
  return dbOf(ctx).classification.findFirst({
    where: { systemId, orgId: ctx.orgId, status: "DRAFT" },
    orderBy: { createdAt: "desc" },
  });
}

/** Brouillon en cours du système, créé s'il n'existe pas (questionnaire ouvert ou repris). */
export async function openDraft(ctx: OrgContext, input: { systemId: string }) {
  const system = await activeSystem(ctx, input.systemId);
  const existing = await findDraft(ctx, system.id);
  if (existing) return view(existing);
  const created = await dbOf(ctx).classification.create({
    data: {
      orgId: ctx.orgId,
      systemId: system.id,
      rulesetVersion: CURRENT_RULESET,
      answers: { responses: {} },
      tier: "UNCLASSIFIED",
      role: system.role,
      annexIIIPoints: [],
      art63Conditions: [],
      reasoning: [],
    },
  });
  await record(ctx, "classification.draft", created.id, {
    systemId: system.id,
    rulesetVersion: CURRENT_RULESET,
  });
  return view(created);
}

async function requireDraft(ctx: OrgContext, systemId: string) {
  await activeSystem(ctx, systemId);
  const draft = await findDraft(ctx, systemId);
  if (!draft) throw new ServiceError("NOT_FOUND", "classification.noDraft");
  return draft;
}

/**
 * Enregistre la réponse à une question (enregistrement automatique). Les réponses d'une branche abandonnée après un
 * retour arrière sont retirées ; un résultat déjà calculé est effacé, puisqu'il ne correspond plus aux réponses.
 */
export async function saveAnswer(
  ctx: OrgContext,
  input: { systemId: string; questionId: QuestionId; value: unknown },
) {
  if (!isValidResponse(input.questionId, input.value)) {
    throw new ServiceError("BAD_REQUEST", "classification.invalidResponse");
  }
  const draft = await requireDraft(ctx, input.systemId);
  const before = responsesOf(draft.answers);
  const responses = pruneResponses({ ...before, [input.questionId]: input.value });
  const { count } = await dbOf(ctx).classification.updateMany({
    where: { id: draft.id, status: "DRAFT" },
    data: {
      answers: { responses },
      tier: "UNCLASSIFIED",
      annexIIIPoints: [],
      art63Conditions: [],
      involvesProfiling: false,
      reasoning: [],
    },
  });
  if (count === 0) throw new ServiceError("CONFLICT", "classification.notDraft");
  await record(ctx, "classification.saveAnswers", draft.id, {
    systemId: draft.systemId,
    questionId: input.questionId,
    before: before[input.questionId] ?? null,
    after: input.value,
  });
  return view({ ...draft, answers: { responses }, tier: "UNCLASSIFIED" });
}

/** Calcule la classification d'un questionnaire complet avec la version de règles du brouillon. */
export async function computeDraft(ctx: OrgContext, input: { systemId: string }) {
  const draft = await requireDraft(ctx, input.systemId);
  const responses = responsesOf(draft.answers);
  if (pathOf(responses).current !== null) {
    throw new ServiceError("BAD_REQUEST", "classification.incomplete");
  }
  const result = classify(toAnswers(responses), draft.rulesetVersion);
  const data = {
    tier: result.tier,
    role: result.role,
    annexIIIPoints: result.annexIIIPoints,
    art63Conditions: result.art63Conditions,
    involvesProfiling: result.involvesProfiling,
    reasoning: result.reasoning as unknown as object,
  };
  const { count } = await dbOf(ctx).classification.updateMany({
    where: { id: draft.id, status: "DRAFT" },
    data,
  });
  if (count === 0) throw new ServiceError("CONFLICT", "classification.notDraft");
  await record(ctx, "classification.compute", draft.id, {
    systemId: draft.systemId,
    rulesetVersion: draft.rulesetVersion,
    tier: result.tier,
    role: result.role,
    annexIIIPoints: result.annexIIIPoints,
  });
  return view({ ...draft, ...data });
}
