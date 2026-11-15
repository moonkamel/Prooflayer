// PL-607 — Passage quotidien (/api/cron/daily) : avis de purge pour fin de contrat, puis purges arrivées à échéance.
import { scheduleDeletionNotice, schedulePurge } from "./jobs/org-deletion";
import { dueDeletions } from "./org-deletion";

export async function scheduleOrgDeletions(now: Date = new Date()) {
  const { noticed, newlyScheduled, due } = await dueDeletions(now);
  for (const id of newlyScheduled) await scheduleDeletionNotice(id);
  for (const id of due) await schedulePurge(id);
  return { noticed, purges: due.length };
}
