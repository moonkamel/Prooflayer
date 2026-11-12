// Passage quotidien d'évaluation (PL-401) : un job `control.sweepOrg` par organisation et par jour (clé de
// déduplication datée), qui reprogramme ses contrôles évaluables pour la péremption et les fenêtres glissantes.
// Appelé par le cron quotidien (`/api/cron/daily`, vercel.json).
import { prisma } from "@/server/db";
import { controlSweepOrgJob } from "./jobs/control-evaluate";
import { enqueue } from "./jobs/queue";

export async function scheduleDailySweep(now: Date = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const orgs = await prisma.organization.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  let scheduled = 0;
  for (const { id } of orgs) {
    const result = await enqueue(
      controlSweepOrgJob,
      { day },
      { orgId: id, dedupeKey: `control.sweepOrg:${id}:${day}` },
    );
    if (!result.deduplicated) scheduled += 1;
  }
  return { day, organizations: orgs.length, scheduled };
}
