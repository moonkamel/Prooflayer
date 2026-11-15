// Mise en route guidée (PL-604, §5.1) : progression de l'organisation dans les 5 étapes, et écran 7 « capture en
// direct » : preuves capturées par type pour un système, contrôles qui passent de « en attente » à leur statut.
import { withOrgTransaction } from "@/server/db";
import { captureStatus, onboardingSteps } from "./onboarding-data";
import { ServiceError } from "./errors";
import type { OrgContext } from "./organization";

/** `onboarding.progress` : tout membre. */
export async function onboardingProgress(ctx: OrgContext) {
  return withOrgTransaction(ctx.orgId, async (tx) => {
    const [system, classified, integration, evidence, pack] = await Promise.all([
      tx.aiSystem.findFirst({
        where: { orgId: ctx.orgId, archivedAt: null },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      }),
      tx.classification.findFirst({
        where: { orgId: ctx.orgId, status: "SIGNED" },
        select: { id: true },
      }),
      tx.integration.findFirst({
        where: { orgId: ctx.orgId, status: "ACTIVE", provider: { in: ["GITHUB", "JIRA"] } },
        select: { id: true },
      }),
      tx.evidenceItem.findFirst({
        where: { orgId: ctx.orgId, NOT: { kind: { startsWith: "system." } } },
        select: { id: true },
      }),
      tx.auditPack.findFirst({
        where: { orgId: ctx.orgId, status: "READY" },
        select: { id: true },
      }),
    ]);
    return onboardingSteps({
      systemId: system?.id ?? null,
      classified: Boolean(classified),
      connected: Boolean(integration),
      captured: Boolean(evidence),
      packed: Boolean(pack),
    });
  });
}

/**
 * `onboarding.capture` (écran 7) : preuves du système par type (ressources liées et preuves rattachées à ses contrôles,
 * hors preuves émises par ProofLayer), et ses contrôles avec leur statut, « en attente » tant qu'aucune évaluation.
 */
export async function liveCapture(ctx: OrgContext, input: { systemId: string }) {
  return withOrgTransaction(ctx.orgId, async (tx) => {
    const system = await tx.aiSystem.findFirst({
      where: { id: input.systemId, orgId: ctx.orgId },
      select: { id: true, name: true },
    });
    if (!system) throw new ServiceError("NOT_FOUND", "system.notFound");
    const [byKind, instances, sources] = await Promise.all([
      tx.$queryRaw<{ kind: string; n: bigint }[]>`
        SELECT kind, count(*) AS n FROM (
          SELECT e.id, e.kind FROM "SystemResourceLink" l
            JOIN "EvidenceItem" e ON e."resourceId" = l."resourceId"
            WHERE l."systemId" = ${system.id}
          UNION
          SELECT e.id, e.kind FROM "EvidenceLink" el
            JOIN "ControlInstance" ci ON ci.id = el."controlInstanceId"
            JOIN "EvidenceItem" e ON e.id = el."evidenceId"
            WHERE ci."systemId" = ${system.id}
        ) items
        WHERE kind NOT LIKE 'system.%'
        GROUP BY kind ORDER BY count(*) DESC, kind`,
      tx.controlInstance.findMany({
        where: { systemId: system.id },
        select: {
          id: true,
          status: true,
          notApplicable: true,
          lastEvaluatedAt: true,
          definition: { select: { key: true, title: true } },
        },
        orderBy: { definition: { key: "asc" } },
      }),
      tx.systemResourceLink.count({ where: { systemId: system.id } }),
    ]);
    const controls = instances.map((i) => ({
      id: i.id,
      key: i.definition.key,
      title: i.definition.title as { fr: string; en: string },
      status: captureStatus({
        status: i.status,
        notApplicable: i.notApplicable,
        evaluatedAt: i.lastEvaluatedAt,
      }),
    }));
    return {
      system,
      linkedSources: sources,
      evidence: byKind.map((r) => ({ kind: r.kind, count: Number(r.n) })),
      total: byKind.reduce((n, r) => n + Number(r.n), 0),
      controls,
      pending: controls.filter((c) => c.status === "PENDING").length,
    };
  });
}
