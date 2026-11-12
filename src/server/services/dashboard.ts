// Dashboard (PL-406, §5.3 écran C ; routeur `dashboard` du §4.4.2) : synthèse d'un système (compteurs, courbe de
// couverture sur 90 jours, contrôles avec dernier statut, preuves liées par source, responsable) et vue organisation.
// Lecture seule, tout membre. Une seule transaction par synthèse (RLS : app.org_id positionné), requêtes agrégées.
import { withOrgTransaction } from "@/server/db";
import { usersByIds } from "@/server/system/identity";
import type { AutomationLevel, ControlStatus, IntegrationStatus } from "@/generated/prisma/enums";
import {
  articleOf,
  articleOrder,
  connectorOf,
  countStatuses,
  coverageTimeline,
  dominantSource,
} from "./dashboard-data";
import { ServiceError } from "./errors";
import type { OrgContext } from "./organization";

const DAY_MS = 86_400_000;
export const TIMELINE_DAYS = 90;

export interface DashboardControl {
  id: string;
  key: string;
  article: string;
  articleRef: string;
  title: { fr: string; en: string };
  status: ControlStatus;
  automation: AutomationLevel;
  owner: { id: string; name: string } | null;
  evidenceCount: number;
  dominantSource: string | null;
  sources: Record<string, number>;
  lastEvaluatedAt: string | null;
  /** Connecteur requis mais absent : « Connectez GitHub pour évaluer » (§5.3). */
  needsConnector: "GITHUB" | "JIRA" | null;
}

/** `dashboard.systemSummary` : tout ce qu'affiche l'écran C pour un système. */
export async function systemSummary(
  ctx: OrgContext,
  input: { systemId: string },
  now = new Date(),
) {
  return withOrgTransaction(ctx.orgId, async (tx) => {
    const system = await tx.aiSystem.findFirst({
      where: { id: input.systemId, orgId: ctx.orgId },
      select: { id: true, name: true, riskTier: true, archivedAt: true },
    });
    if (!system) throw new ServiceError("NOT_FOUND", "system.notFound");

    const instances = await tx.controlInstance.findMany({
      where: { systemId: system.id },
      select: {
        id: true,
        status: true,
        notApplicable: true,
        ownerUserId: true,
        lastEvaluatedAt: true,
        createdAt: true,
        definition: {
          select: {
            key: true,
            title: true,
            articleRef: true,
            automation: true,
            evaluatorKey: true,
          },
        },
      },
    });
    const ids = instances.map((i) => i.id);
    const windowStart = new Date(now.getTime() - TIMELINE_DAYS * DAY_MS);

    const [bySource, evaluations, lastEvidence, integrations] = await Promise.all([
      ids.length
        ? tx.$queryRaw<{ controlInstanceId: string; source: string; n: bigint }[]>`
            SELECT el."controlInstanceId", e.source::text AS source, count(*) AS n
            FROM "EvidenceLink" el JOIN "EvidenceItem" e ON e.id = el."evidenceId"
            WHERE el."controlInstanceId" = ANY(${ids})
            GROUP BY 1, 2`
        : [],
      ids.length
        ? tx.$queryRaw<{ controlInstanceId: string; status: ControlStatus; evaluatedAt: Date }[]>`
            SELECT "controlInstanceId", status::text AS status, "evaluatedAt" FROM "ControlEvaluation"
            WHERE "controlInstanceId" = ANY(${ids}) AND "evaluatedAt" >= ${windowStart}
            UNION ALL
            SELECT DISTINCT ON ("controlInstanceId") "controlInstanceId", status::text, "evaluatedAt"
            FROM "ControlEvaluation"
            WHERE "controlInstanceId" = ANY(${ids}) AND "evaluatedAt" < ${windowStart}
            ORDER BY "controlInstanceId", "evaluatedAt" DESC`
        : [],
      tx.$queryRaw<{ at: Date | null }[]>`
        SELECT max(e."capturedAt") AS at FROM "EvidenceItem" e
        WHERE e."resourceId" IN (SELECT "resourceId" FROM "SystemResourceLink" WHERE "systemId" = ${system.id})
           OR e.id IN (SELECT "evidenceId" FROM "EvidenceLink" WHERE "controlInstanceId" = ANY(${ids}))
           OR (e.kind LIKE 'system.%' AND e.payload->>'systemId' = ${system.id})`,
      tx.integration.findMany({ select: { id: true, provider: true, status: true } }),
    ]);

    const sources = new Map<string, Record<string, number>>();
    for (const row of bySource) {
      const entry = sources.get(row.controlInstanceId) ?? {};
      entry[row.source] = Number(row.n);
      sources.set(row.controlInstanceId, entry);
    }
    const connected = new Set(
      integrations.filter((i) => i.status === "ACTIVE").map((i) => i.provider),
    );
    const owners = await usersByIds(
      instances.flatMap((i) => (i.ownerUserId ? [i.ownerUserId] : [])),
    );

    const controls: DashboardControl[] = instances
      .map((i) => {
        const counts = sources.get(i.id) ?? {};
        const connector = connectorOf(i.definition.evaluatorKey);
        const owner = i.ownerUserId ? owners.get(i.ownerUserId) : undefined;
        const status = i.notApplicable ? ("NOT_APPLICABLE" as const) : i.status;
        return {
          id: i.id,
          key: i.definition.key,
          article: articleOf(i.definition.articleRef),
          articleRef: i.definition.articleRef,
          title: i.definition.title as { fr: string; en: string },
          status,
          automation: i.definition.automation,
          owner: owner && i.ownerUserId ? { id: i.ownerUserId, name: owner.name } : null,
          evidenceCount: Object.values(counts).reduce((a, b) => a + b, 0),
          dominantSource: dominantSource(counts),
          sources: counts,
          lastEvaluatedAt: i.lastEvaluatedAt?.toISOString() ?? null,
          needsConnector:
            connector && !connected.has(connector) && status === "MISSING" ? connector : null,
        };
      })
      .sort(
        (a, b) => articleOrder(a.article) - articleOrder(b.article) || a.key.localeCompare(b.key),
      );

    return {
      system: {
        id: system.id,
        name: system.name,
        riskTier: system.riskTier,
        archived: system.archivedAt !== null,
      },
      counts: countStatuses(controls.map((c) => c.status)),
      lastEvidenceAt: lastEvidence[0]?.at?.toISOString() ?? null,
      timeline: coverageTimeline({ instances, evaluations }, now, TIMELINE_DAYS),
      controls,
      integrations: {
        connected: [...connected],
        failing: integrations
          .filter((i) => i.status === "ERROR" || i.status === "REVOKED" || i.status === "SUSPENDED")
          .map((i) => ({ provider: i.provider, status: i.status as IntegrationStatus })),
      },
    };
  });
}

/** `dashboard.coverageTimeline` : la courbe seule (90 jours). */
export async function systemCoverageTimeline(ctx: OrgContext, input: { systemId: string }) {
  return (await systemSummary(ctx, input)).timeline;
}

/** `dashboard.orgSummary` : un système par ligne, avec ses compteurs, et les totaux de l'organisation. */
export async function orgSummary(ctx: OrgContext) {
  return withOrgTransaction(ctx.orgId, async (tx) => {
    const systems = await tx.aiSystem.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true, riskTier: true, role: true, classificationStale: true },
      orderBy: { name: "asc" },
    });
    const rows = systems.length
      ? await tx.controlInstance.groupBy({
          by: ["systemId", "status", "notApplicable"],
          where: { systemId: { in: systems.map((s) => s.id) } },
          _count: { _all: true },
        })
      : [];
    const lastEvaluated = systems.length
      ? await tx.controlInstance.groupBy({
          by: ["systemId"],
          where: { systemId: { in: systems.map((s) => s.id) } },
          _max: { lastEvaluatedAt: true },
        })
      : [];
    const integrations = await tx.integration.findMany({
      select: { provider: true, status: true },
    });
    const perSystem = systems.map((s) => {
      const statuses: ControlStatus[] = rows
        .filter((r) => r.systemId === s.id)
        .flatMap((r) =>
          Array<ControlStatus>(r._count._all).fill(r.notApplicable ? "NOT_APPLICABLE" : r.status),
        );
      return {
        ...s,
        counts: countStatuses(statuses),
        lastEvaluatedAt:
          lastEvaluated.find((l) => l.systemId === s.id)?._max.lastEvaluatedAt?.toISOString() ??
          null,
      };
    });
    const total = countStatuses([]);
    for (const s of perSystem) {
      for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += s.counts[k];
    }
    return {
      systems: perSystem,
      total,
      failingIntegrations: integrations
        .filter((i) => i.status !== "ACTIVE")
        .map((i) => ({ provider: i.provider, status: i.status })),
    };
  });
}
