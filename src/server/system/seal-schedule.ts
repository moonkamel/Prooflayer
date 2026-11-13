// Scellement horaire (PL-501) et ancrage (PL-502). Scellement : un job `seal.org` par organisation et par heure (clé datée à l'heure UTC). Appelé par
// le cron `/api/cron/seal` (vercel.json) ; le drainage de chaque minute exécute les jobs.
import { prisma } from "@/server/db";
import { checkAnchorBacklog } from "./anchoring";
import { jobRegistry } from "./jobs/handlers";
import { sealAnchorJob, sealOrgJob } from "./jobs/seal";
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

/** Fenêtre d'ancrage de 6 heures (UTC) : « 2026-11-13T12 » pour 12:00 à 17:59. */
export const anchorWindow = (now: Date) => {
  const hour = Math.floor(now.getUTCHours() / 6) * 6;
  return `${now.toISOString().slice(0, 10)}T${String(hour).padStart(2, "0")}`;
};

/**
 * Ancrage toutes les 6 heures (PL-502) : un job `seal.anchor` par fenêtre, après une vérification du retard
 * d'ancrage (alerte si un lot attend depuis plus de 8 heures). Appelé par le cron `/api/cron/anchor`.
 */
export async function scheduleAnchoring(now: Date = new Date()) {
  const window = anchorWindow(now);
  const backlog = await prisma.$transaction((tx) => checkAnchorBacklog(tx, now));
  const result = await enqueue(sealAnchorJob, { window }, { dedupeKey: `seal.anchor:${window}` });
  return { window, scheduled: !result.deduplicated, ...backlog };
}

/** Ancrage à la demande (export d'un pack, §4.6.2) : exécuté aussitôt, dédupliqué à la minute. */
export async function requestAnchorNow(now: Date = new Date()) {
  return enqueue(
    sealAnchorJob,
    { window: `now:${now.toISOString().slice(0, 16)}` },
    {
      dedupeKey: `seal.anchor:now:${now.toISOString().slice(0, 16)}`,
      runNow: { registry: jobRegistry },
    },
  );
}
