// Écran de veille (PL-603, §3.2 E12) : entrées publiées par ProofLayer, chacune avec sa source, sa date d'effet et les
// contrôles concernés, reliés aux contrôles de l'organisation (système, statut) pour qu'un administrateur voie d'un
// coup d'œil ce qu'une évolution touche chez lui.
import { listWatchUpdates } from "@/server/system/regulatory-updates";
import type { OrgContext } from "./organization";

const dbOf = (ctx: OrgContext) => {
  if (!ctx.db) throw new Error("forOrg(orgId) requis");
  return ctx.db;
};

export async function watchFeed(ctx: OrgContext, now = new Date()) {
  const updates = await listWatchUpdates(now);
  const keys = [...new Set(updates.flatMap((u) => u.impactedControlKeys))];
  const instances = keys.length
    ? await dbOf(ctx).controlInstance.findMany({
        where: { definition: { key: { in: keys } }, system: { archivedAt: null } },
        select: {
          id: true,
          status: true,
          notApplicable: true,
          definition: { select: { key: true, title: true } },
          system: { select: { id: true, name: true } },
        },
        orderBy: [{ system: { name: "asc" } }],
      })
    : [];
  return updates.map((u) => {
    const summary = u.summary as { fr: string; en: string; source?: { fr: string; en: string } };
    return {
      id: u.id,
      publishedAt: u.publishedAt.toISOString(),
      effectiveDate: u.effectiveDate?.toISOString() ?? null,
      severity: u.severity,
      title: u.title as { fr: string; en: string },
      summary: { fr: summary.fr, en: summary.en },
      source: summary.source ?? null,
      controls: u.impactedControlKeys.map((key) => ({
        key,
        instances: instances
          .filter((i) => i.definition.key === key)
          .map((i) => ({
            controlId: i.id,
            systemId: i.system.id,
            systemName: i.system.name,
            title: i.definition.title as { fr: string; en: string },
            status: i.notApplicable ? ("NOT_APPLICABLE" as const) : i.status,
          })),
      })),
    };
  });
}
