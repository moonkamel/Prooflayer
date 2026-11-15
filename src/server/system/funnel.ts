// PL-608 — Entonnoir sur l'ensemble des organisations (§1.4) : passage quotidien (étapes nouvelles inscrites et, si
// PostHog est configuré, transmises) et rapport du fondateur (`pnpm funnel:report`).
import { prisma, withOrgTransaction } from "@/server/db";
import { funnelSummary, type OrgFunnel } from "@/server/services/funnel-data";
import { syncFunnelEvents } from "@/server/services/funnel";
import { analyticsDependencies, scheduleAnalyticsCapture } from "./jobs/analytics";

export async function syncAllFunnels() {
  const orgs = await prisma.organization.findMany({
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const forward = analyticsDependencies.config() !== null;
  const rows: { orgId: string; name: string; funnel: OrgFunnel }[] = [];
  let created = 0;
  for (const org of orgs) {
    const funnel = await withOrgTransaction(org.id, async (tx) => {
      const result = await syncFunnelEvents(tx, org.id);
      created += result.created.length;
      if (forward) {
        const unsent = await tx.funnelEvent.findMany({
          where: { orgId: org.id, sentAt: null },
          select: { id: true },
        });
        for (const e of unsent) await scheduleAnalyticsCapture(tx, org.id, e.id);
      }
      return result.funnel;
    });
    rows.push({ orgId: org.id, name: org.name, funnel });
  }
  return { rows, created, summary: funnelSummary(rows.map((r) => r.funnel)) };
}
