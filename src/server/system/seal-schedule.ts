// Scellement horaire (PL-501) : un job `seal.org` par organisation et par heure (clé datée à l'heure UTC). Appelé par
// le cron `/api/cron/seal` (vercel.json) ; le drainage de chaque minute exécute les jobs.
import { prisma } from "@/server/db";
import { sealOrgJob } from "./jobs/seal";
import { enqueue } from "./jobs/queue";

export const sealHour = (now: Date) => now.toISOString().slice(0, 13);

export async function scheduleHourlySealing(now: Date = new Date()) {
  const hour = sealHour(now);
  const orgs = await prisma.organization.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  let scheduled = 0;
  for (const { id } of orgs) {
    const result = await enqueue(
      sealOrgJob,
      { hour },
      { orgId: id, dedupeKey: `seal.org:${id}:${hour}` },
    );
    if (!result.deduplicated) scheduled += 1;
  }
  return { hour, organizations: orgs.length, scheduled };
}
