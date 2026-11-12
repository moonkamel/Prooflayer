// Contrôles d'un système (PL-207, §9.4, §3.2 E6). À la signature d'une classification, les contrôles applicables à
// la catégorie et au rôle sont ouverts ; une reclassification ajoute les manquants et marque les autres non
// applicables, sans rien supprimer. L'évaluation des contrôles arrive au sprint 4.
import type { OrgTransaction } from "@/server/db";
import type { AiActRole, RiskTier } from "@/generated/prisma/enums";
import { LIBRARY_VERSION } from "@/server/rules/library";
import { NA_BY_RECLASSIFICATION, planInstances } from "@/server/rules/instantiate";
import { ServiceError } from "./errors";
import type { OrgContext } from "./organization";

export interface InstantiationReport {
  libraryVersion: string;
  applicable: number;
  created: number;
  markedNotApplicable: number;
  reactivated: number;
}

/**
 * Ouvre les contrôles d'un système dans la transaction de signature : la classification signée et ses contrôles
 * existent ensemble ou pas du tout. Les définitions viennent de `ControlDefinition` (version courante publiée).
 */
export async function instantiateControls(
  tx: OrgTransaction,
  input: { orgId: string; systemId: string; tier: RiskTier; role: AiActRole },
): Promise<InstantiationReport> {
  const published = await tx.controlDefinition.count({
    where: { libraryVersion: LIBRARY_VERSION },
  });
  if (published === 0) throw new ServiceError("CONFLICT", "controls.libraryNotPublished");
  const applicable = await tx.controlDefinition.findMany({
    where: {
      libraryVersion: LIBRARY_VERSION,
      deprecatedAt: null,
      appliesToTiers: { has: input.tier },
      appliesToRoles: { has: input.role },
    },
    select: { id: true },
    orderBy: { key: "asc" },
  });
  const existing = await tx.controlInstance.findMany({
    where: { systemId: input.systemId },
    select: { id: true, definitionId: true, notApplicable: true, naJustification: true },
  });
  const plan = planInstances(
    applicable.map((d) => d.id),
    existing,
  );
  if (plan.create.length > 0) {
    await tx.controlInstance.createMany({
      data: plan.create.map((definitionId) => ({
        orgId: input.orgId,
        systemId: input.systemId,
        definitionId,
      })),
    });
  }
  if (plan.markNotApplicable.length > 0) {
    await tx.controlInstance.updateMany({
      where: { id: { in: plan.markNotApplicable } },
      data: {
        notApplicable: true,
        naJustification: NA_BY_RECLASSIFICATION,
        status: "NOT_APPLICABLE",
      },
    });
  }
  if (plan.reactivate.length > 0) {
    await tx.controlInstance.updateMany({
      where: { id: { in: plan.reactivate } },
      data: { notApplicable: false, naJustification: null, status: "MISSING" },
    });
  }
  return {
    libraryVersion: LIBRARY_VERSION,
    applicable: applicable.length,
    created: plan.create.length,
    markedNotApplicable: plan.markNotApplicable.length,
    reactivated: plan.reactivate.length,
  };
}

/** Contrôles d'un système, par clé (§4.4.2 `control.listBySystem`). Lecture : tout membre. */
export async function listControlsBySystem(ctx: OrgContext, input: { systemId: string }) {
  if (!ctx.db) throw new Error("forOrg(orgId) requis");
  const system = await ctx.db.aiSystem.findFirst({
    where: { id: input.systemId, orgId: ctx.orgId },
  });
  if (!system) throw new ServiceError("NOT_FOUND", "system.notFound");
  const rows = await ctx.db.controlInstance.findMany({
    where: { systemId: system.id },
    include: { definition: true },
  });
  return rows
    .map((r) => ({
      id: r.id,
      key: r.definition.key,
      pack: r.definition.pack,
      articleRef: r.definition.articleRef,
      title: r.definition.title as { fr: string; en: string },
      statement: r.definition.statement as { fr: string; en: string },
      automation: r.definition.automation,
      status: r.status,
      notApplicable: r.notApplicable,
      /** Vrai si le contrôle a été écarté par une reclassification, et non par un administrateur. */
      notApplicableByReclassification: r.naJustification === NA_BY_RECLASSIFICATION,
      lastEvaluatedAt: r.lastEvaluatedAt?.toISOString() ?? null,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
