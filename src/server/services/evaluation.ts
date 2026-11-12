// Évaluation des contrôles (PL-401, §3.2 E6) : lecture des preuves d'un contrôle, appel du moteur pur, historisation.
// - Réévaluation incrémentale : une preuve nouvelle ne programme que les contrôles qui acceptent son type, sur les
//   systèmes qui observent sa ressource ; un job `control.evaluate` par contrôle, dédupliqué tant qu'il attend.
// - Passage quotidien : chaque contrôle évaluable de l'organisation est reprogrammé (péremption, fenêtres glissantes).
// Toutes les fonctions s'exécutent dans une transaction où app.org_id est positionné (job ou withOrgTransaction).
import type { OrgTransaction } from "@/server/db";
import { EVALUATORS, implementedEvaluatorKeys } from "@/server/rules/evaluators";
import { evaluate, type EvidenceRecord, type EvaluatorRegistry } from "@/server/rules/engine";
import type { Evaluation } from "@/server/rules/evaluation";

export const EVALUATION_JOB = "control.evaluate";
export const evaluationDedupeKey = (controlInstanceId: string) =>
  `${EVALUATION_JOB}:${controlInstanceId}`;

/** Programme l'évaluation d'un contrôle ; fourni par la file de jobs (évite une dépendance circulaire). */
export type ScheduleEvaluation = (
  tx: OrgTransaction,
  orgId: string,
  instanceId: string,
) => Promise<string | null>;

/** Contrôles évaluables : instance applicable, système non archivé, évaluateur livré. */
const evaluableWhere = (registry: EvaluatorRegistry) => ({
  notApplicable: false,
  system: { archivedAt: null },
  definition: { evaluatorKey: { in: implementedEvaluatorKeys(registry) } },
});

/** Preuve nouvelle, telle que la réévaluation incrémentale la cible. */
export interface NewEvidence {
  id: string;
  kind: string;
  resourceId: string | null;
  /** Preuve émise par ProofLayer sur un système (`system.*`, PL-402). */
  systemId?: string;
}

/**
 * Contrôles concernés par des preuves nouvelles : ceux qui acceptent leur type, sur les systèmes liés à leur
 * ressource (`SystemResourceLink`), sur le système d'une preuve `system.*`, ou rattachés par `EvidenceLink`.
 */
export async function instancesConcernedBy(
  tx: OrgTransaction,
  evidence: NewEvidence[],
  registry: EvaluatorRegistry = EVALUATORS,
): Promise<string[]> {
  if (evidence.length === 0) return [];
  const kinds = [...new Set(evidence.map((e) => e.kind))];
  const resourceIds = [...new Set(evidence.flatMap((e) => (e.resourceId ? [e.resourceId] : [])))];
  const links = resourceIds.length
    ? await tx.systemResourceLink.findMany({
        where: { resourceId: { in: resourceIds } },
        select: { systemId: true },
      })
    : [];
  const systemIds = [
    ...new Set([
      ...links.map((l) => l.systemId),
      ...evidence.flatMap((e) => (e.systemId ? [e.systemId] : [])),
    ]),
  ];
  const instances = await tx.controlInstance.findMany({
    where: {
      ...evaluableWhere(registry),
      definition: {
        evaluatorKey: { in: implementedEvaluatorKeys(registry) },
        evidenceKinds: { hasSome: kinds },
      },
      OR: [
        ...(systemIds.length ? [{ systemId: { in: systemIds } }] : []),
        { evidenceLinks: { some: { evidenceId: { in: evidence.map((e) => e.id) } } } },
      ],
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return instances.map((i) => i.id);
}

/**
 * Programme la réévaluation des contrôles concernés par des preuves nouvelles. Retourne les jobs créés ou réarmés,
 * à exécuter aussitôt après la validation de la transaction (le cron reste le filet de sécurité).
 */
export async function scheduleEvaluations(
  tx: OrgTransaction,
  orgId: string,
  evidence: NewEvidence[],
  schedule: ScheduleEvaluation,
): Promise<string[]> {
  const jobs: string[] = [];
  for (const id of await instancesConcernedBy(tx, evidence)) {
    const job = await schedule(tx, orgId, id);
    if (job) jobs.push(job);
  }
  return jobs;
}

/**
 * Passage quotidien : programme tous les contrôles évaluables de l'organisation, ou d'un seul système (à la
 * signature d'une classification, les contrôles ouverts sont évalués sur les preuves déjà présentes).
 */
export async function scheduleOrgSweep(
  tx: OrgTransaction,
  orgId: string,
  schedule: ScheduleEvaluation,
  systemId?: string,
): Promise<number> {
  const instances = await tx.controlInstance.findMany({
    where: { ...evaluableWhere(EVALUATORS), ...(systemId ? { systemId } : {}) },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const { id } of instances) await schedule(tx, orgId, id);
  return instances.length;
}

/**
 * Preuves lues par l'évaluateur d'un contrôle : types acceptés, ressources du système, preuves `system.*` du système,
 * ou rattachement explicite.
 */
async function evidenceFor(
  tx: OrgTransaction,
  instance: { id: string; systemId: string; evidenceKinds: string[] },
): Promise<EvidenceRecord[]> {
  const resources = await tx.systemResourceLink.findMany({
    where: { systemId: instance.systemId },
    select: { resourceId: true },
  });
  const rows = await tx.evidenceItem.findMany({
    where: {
      kind: { in: instance.evidenceKinds },
      OR: [
        ...(resources.length ? [{ resourceId: { in: resources.map((r) => r.resourceId) } }] : []),
        {
          kind: { startsWith: "system." },
          payload: { path: ["systemId"], equals: instance.systemId },
        },
        { links: { some: { controlInstanceId: instance.id } } },
      ],
    },
    select: {
      id: true,
      kind: true,
      resourceId: true,
      occurredAt: true,
      capturedAt: true,
      payload: true,
      declarative: true,
      validUntil: true,
      links: { where: { controlInstanceId: instance.id }, select: { linkedBy: true } },
    },
  });
  return rows.map(({ links, ...row }) => ({
    ...row,
    linkedByUser: links.some((l) => l.linkedBy !== "rule"),
  }));
}

/** Inscrit une évaluation (historique avec preuves et version) et reporte son statut sur l'instance. */
export async function writeEvaluation(
  tx: OrgTransaction,
  input: {
    orgId: string;
    instance: { id: string; notApplicable: boolean };
    evaluatorVersion: string;
    evaluation: Evaluation;
    at: Date;
  },
) {
  await tx.controlEvaluation.create({
    data: {
      orgId: input.orgId,
      controlInstanceId: input.instance.id,
      status: input.evaluation.status,
      reasons: input.evaluation.reasons as unknown as object,
      evidenceIds: input.evaluation.evidenceIds,
      evaluatorVersion: input.evaluatorVersion,
      evaluatedAt: input.at,
    },
  });
  await tx.controlInstance.update({
    where: { id: input.instance.id },
    data: {
      // Une instance écartée (non applicable) garde son statut.
      ...(input.instance.notApplicable ? {} : { status: input.evaluation.status }),
      lastEvaluatedAt: input.at,
    },
  });
}

export type EvaluateOutcome =
  | { evaluated: true; status: Evaluation["status"]; evidenceIds: string[] }
  | { evaluated: false; reason: "not_found" | "not_evaluable" | "no_evaluator" };

/** Évalue un contrôle d'un système à partir des preuves disponibles (job `control.evaluate`). */
export async function evaluateInstance(
  tx: OrgTransaction,
  orgId: string,
  instanceId: string,
  now: Date,
  registry: EvaluatorRegistry = EVALUATORS,
): Promise<EvaluateOutcome> {
  const instance = await tx.controlInstance.findUnique({
    where: { id: instanceId },
    include: { definition: true, system: { select: { archivedAt: true } } },
  });
  if (!instance || instance.orgId !== orgId) return { evaluated: false, reason: "not_found" };
  if (instance.notApplicable || instance.system.archivedAt) {
    return { evaluated: false, reason: "not_evaluable" };
  }
  const definition = instance.definition;
  const evidence = await evidenceFor(tx, {
    id: instance.id,
    systemId: instance.systemId,
    evidenceKinds: definition.evidenceKinds,
  });
  const result = evaluate(
    {
      key: definition.key,
      evaluatorKey: definition.evaluatorKey,
      evidenceKinds: definition.evidenceKinds,
      freshnessDays: definition.freshnessDays,
      params: (definition.params ?? {}) as Record<string, unknown>,
    },
    evidence,
    now,
    registry,
  );
  if (!result) return { evaluated: false, reason: "no_evaluator" };
  await writeEvaluation(tx, {
    orgId,
    instance,
    evaluatorVersion: result.evaluatorVersion,
    evaluation: result.evaluation,
    at: now,
  });
  // Liens de preuve (§4.3.2 `EvidenceLink`, « rule ») : les preuves retenues par l'évaluation justifient le contrôle.
  const known = new Set(evidence.map((e) => e.id));
  const used = result.evaluation.evidenceIds.filter((id) => known.has(id));
  if (used.length > 0) {
    await tx.evidenceLink.createMany({
      data: used.map((evidenceId) => ({
        evidenceId,
        controlInstanceId: instance.id,
        orgId,
        linkedBy: "rule",
      })),
      skipDuplicates: true,
    });
  }
  return { evaluated: true, status: result.evaluation.status, evidenceIds: used };
}
