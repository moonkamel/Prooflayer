// Classification d'un système (PL-203, §3.2 E1, §4.4.2 routeur `classification`). Un brouillon par système :
// réponses enregistrées à chaque question (enregistrement automatique), reprise là où l'utilisateur s'est arrêté,
// calcul par le moteur pur (src/server/classify/engine.ts), signature (PL-204) : une classification signée est
// immuable (trigger classification_guard) ; une nouvelle signature remplace la précédente (SUPERSEDED).
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { withOrgTransaction } from "@/server/db";
import { usersByIds } from "@/server/system/identity";
import { CURRENT_RULESET, classify } from "@/server/classify/engine";
import {
  isValidResponse,
  pathOf,
  pruneResponses,
  toAnswers,
  type QuestionId,
  type Responses,
} from "@/server/classify/questionnaire";
import type { ReasoningStep } from "@/server/classify/engine";
import { audit, clientIp, type AuditAction } from "./audit";
import { instantiateControls } from "./controls";
import { scheduleOrgSweep } from "./evaluation";
import { scheduleEvaluation } from "@/server/system/jobs/control-evaluate";
import { assertSignAttemptsLeft, recordSignRefusal, type SignDependencies } from "./sign-guard";

export type { SignDependencies } from "./sign-guard";
export { SIGN_ATTEMPT_WINDOW_MS, SIGN_MAX_REFUSALS } from "./sign-guard";
import { evaluateExemptionControl } from "./exemption";
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
    status: row.status,
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
          reasoning: row.reasoning as unknown as ReasoningStep[],
        }
      : null,
    signature:
      row.status === "DRAFT"
        ? null
        : {
            name: row.signedByName,
            title: row.signedByTitle,
            at: row.signedAt?.toISOString() ?? null,
            statement: row.signatureStatement,
          },
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

/**
 * Brouillon en cours du système, créé s'il n'existe pas. Une requalification reprend les réponses de la version
 * signée en vigueur (§2.2 : seule la réponse qui a changé est à modifier) ; le résultat reste à recalculer, avec la
 * version de règles courante. Les réponses devenues invalides ou hors chemin sont écartées.
 */
export async function openDraft(ctx: OrgContext, input: { systemId: string }) {
  const system = await activeSystem(ctx, input.systemId);
  const existing = await findDraft(ctx, system.id);
  if (existing) return view(existing);
  const signed = await dbOf(ctx).classification.findFirst({
    where: { systemId: system.id, orgId: ctx.orgId, status: "SIGNED" },
    orderBy: { signedAt: "desc" },
  });
  const responses = signed
    ? pruneResponses(
        Object.fromEntries(
          Object.entries(responsesOf(signed.answers)).filter(([id, value]) =>
            isValidResponse(id as QuestionId, value),
          ),
        ) as Responses,
      )
    : {};
  const created = await dbOf(ctx).classification.create({
    data: {
      orgId: ctx.orgId,
      systemId: system.id,
      rulesetVersion: CURRENT_RULESET,
      answers: { responses },
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
    ...(signed ? { prefilledFrom: signed.id } : {}),
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
 * Enregistre la réponse à une question (enregistrement automatique). Un résultat déjà calculé est effacé, puisqu'il
 * ne correspond plus aux réponses.
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
  // Les réponses déjà données sont conservées : si le nouveau chemin repasse par leurs questions, l'utilisateur les
  // retrouve et n'a pas à les ressaisir. Celles restées hors du chemin sont écartées au calcul (computeDraft).
  const responses: Responses = { ...before, [input.questionId]: input.value };
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
  const stored = responsesOf(draft.answers);
  if (pathOf(stored).current !== null) {
    throw new ServiceError("BAD_REQUEST", "classification.incomplete");
  }
  // Seules les réponses du chemin parcouru fondent la classification et sont gardées avec elle.
  const responses = pruneResponses(stored);
  const result = classify(toAnswers(responses), draft.rulesetVersion);
  const data = {
    answers: { responses },
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

/** Brouillon en cours et dernière classification signée du système, sans rien créer (lecture : tout membre). */
export async function currentClassification(ctx: OrgContext, input: { systemId: string }) {
  const db = dbOf(ctx);
  const system = await db.aiSystem.findFirst({ where: { id: input.systemId, orgId: ctx.orgId } });
  if (!system) throw new ServiceError("NOT_FOUND", "system.notFound");
  const [draft, signed] = await Promise.all([
    findDraft(ctx, system.id),
    db.classification.findFirst({
      where: { systemId: system.id, orgId: ctx.orgId, status: "SIGNED" },
      orderBy: { signedAt: "desc" },
    }),
  ]);
  return { draft: draft ? view(draft) : null, signed: signed ? view(signed) : null };
}

/** Déclaration signée (§5.3 écran A), dans la langue du signataire. */
export function signatureStatement(locale: string): string {
  return (locale === "en" ? en : fr).classificationResult.statement;
}

/**
 * Signature (§3.2 E1, §5.3 écran A) : nom, fonction, déclaration, confirmation par mot de passe. Dans une même
 * transaction : la classification signée précédente passe à SUPERSEDED, le brouillon devient SIGNED, la fiche
 * reprend la catégorie, les points de l'Annexe III et le rôle, et n'est plus « à revoir ». Une pratique interdite
 * ne se signe pas : elle doit cesser (§5.3, variante PROHIBITED).
 */
export async function signClassification(
  ctx: OrgContext,
  input: { systemId: string; name: string; title: string; password: string; locale: string },
  deps: SignDependencies,
) {
  const draft = await requireDraft(ctx, input.systemId);
  if (draft.tier === "UNCLASSIFIED")
    throw new ServiceError("BAD_REQUEST", "classification.notComputed");
  if (draft.tier === "PROHIBITED")
    throw new ServiceError("BAD_REQUEST", "classification.prohibited");
  await assertSignAttemptsLeft(ctx);
  if (!(await deps.verifyPassword(input.password))) {
    await recordSignRefusal(ctx, {
      systemId: draft.systemId,
      target: "classification",
      targetId: draft.id,
    });
    throw new ServiceError("FORBIDDEN", "classification.invalidPassword");
  }
  const statement = signatureStatement(input.locale);
  const signedAt = new Date();
  const { superseded, roleBefore, controls } = await withOrgTransaction(ctx.orgId, async (tx) => {
    const previous = await tx.classification.findMany({
      where: { systemId: draft.systemId, status: "SIGNED" },
      select: { id: true },
    });
    await tx.classification.updateMany({
      where: { systemId: draft.systemId, status: "SIGNED" },
      data: { status: "SUPERSEDED" },
    });
    const { count } = await tx.classification.updateMany({
      where: { id: draft.id, status: "DRAFT", tier: draft.tier },
      data: {
        status: "SIGNED",
        signedByUserId: ctx.userId,
        signedByName: input.name,
        signedByTitle: input.title,
        signedAt,
        signatureStatement: statement,
      },
    });
    if (count === 0) throw new ServiceError("CONFLICT", "classification.notDraft");
    const system = await tx.aiSystem.findUniqueOrThrow({ where: { id: draft.systemId } });
    await tx.aiSystem.update({
      where: { id: draft.systemId },
      data: {
        riskTier: draft.tier,
        annexIIIPoints: draft.annexIIIPoints,
        role: draft.role,
        classificationStale: false,
      },
    });
    // Contrôles ouverts dans la même transaction : la classification signée ne va pas sans eux (PL-207).
    const controls = await instantiateControls(tx, {
      orgId: ctx.orgId,
      systemId: draft.systemId,
      tier: draft.tier,
      role: draft.role,
    });
    // AIA-06-02 : un système exempté sans dossier signé est « preuve absente » ; un système non exempté, non concerné.
    await evaluateExemptionControl(tx, {
      orgId: ctx.orgId,
      systemId: draft.systemId,
      at: signedAt,
    });
    // Les autres contrôles évaluables sont jugés sur les preuves déjà présentes (PL-401), par la file de jobs.
    await scheduleOrgSweep(tx, ctx.orgId, scheduleEvaluation, draft.systemId);
    return { superseded: previous.map((p) => p.id), roleBefore: system.role, controls };
  });

  await record(ctx, "classification.sign", draft.id, {
    systemId: draft.systemId,
    rulesetVersion: draft.rulesetVersion,
    tier: draft.tier,
    role: draft.role,
    annexIIIPoints: draft.annexIIIPoints,
    signedByName: input.name,
    signedByTitle: input.title,
    supersedes: superseded,
  });
  await audit(
    {
      orgId: ctx.orgId,
      actor: { type: "user", id: ctx.userId },
      ipAddress: clientIp(ctx.headers),
      db: ctx.db,
    },
    "control.instantiate",
    { type: "ai_system", id: draft.systemId },
    { classificationId: draft.id, tier: draft.tier, role: draft.role, ...controls },
  );
  // Le rôle de la fiche est un champ historisé (PL-201) : son changement par la signature figure à l'historique.
  if (roleBefore !== draft.role) {
    await audit(
      {
        orgId: ctx.orgId,
        actor: { type: "user", id: ctx.userId },
        ipAddress: clientIp(ctx.headers),
        db: ctx.db,
      },
      "system.update",
      { type: "ai_system", id: draft.systemId },
      {
        changes: [{ field: "role", before: roleBefore, after: draft.role }],
        source: "classification.sign",
      },
    );
  }
  return { id: draft.id, signedAt: signedAt.toISOString(), controls };
}

/** Versions signées et remplacées du système, de la plus récente à la plus ancienne (§4.4.2 `history`). */
export async function classificationHistory(ctx: OrgContext, input: { systemId: string }) {
  const db = dbOf(ctx);
  const system = await db.aiSystem.findFirst({ where: { id: input.systemId, orgId: ctx.orgId } });
  if (!system) throw new ServiceError("NOT_FOUND", "system.notFound");
  const rows = await db.classification.findMany({
    where: { systemId: system.id, status: { in: ["SIGNED", "SUPERSEDED"] } },
    orderBy: [{ signedAt: "desc" }, { id: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    tier: r.tier,
    role: r.role,
    annexIIIPoints: r.annexIIIPoints,
    rulesetVersion: r.rulesetVersion,
    signedByName: r.signedByName,
    signedByTitle: r.signedByTitle,
    signedAt: r.signedAt?.toISOString() ?? null,
  }));
}

/** Données de la note de classification (PDF) : une version précise, brouillon calculé compris. */
export async function classificationNote(
  ctx: OrgContext,
  input: { systemId: string; classificationId: string },
) {
  const db = dbOf(ctx);
  const row = await db.classification.findFirst({
    where: { id: input.classificationId, systemId: input.systemId, orgId: ctx.orgId },
  });
  if (!row) throw new ServiceError("NOT_FOUND", "classification.notFound");
  if (row.tier === "UNCLASSIFIED")
    throw new ServiceError("BAD_REQUEST", "classification.notComputed");
  const system = await db.aiSystem.findUniqueOrThrow({ where: { id: row.systemId } });
  const users = await usersByIds([system.ownerUserId]);
  return {
    system: {
      name: system.name,
      intendedPurpose: system.intendedPurpose,
      owner: users.get(system.ownerUserId)?.name ?? null,
    },
    classification: view(row),
  };
}
