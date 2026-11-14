// Fil de veille (PL-603) : publication des entrées du fichier versionné (src/server/watch/entries.ts) dans la table
// système `RegulatoryUpdate` (§4.3), puis notification des administrateurs de chaque organisation, une seule fois par
// entrée (job `watch.notify`, `notifiedAt`). Appelé par le passage quotidien.
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { regulationUrl } from "@/lib/regulation";
import { publishedEntries, type WatchEntry } from "@/server/watch/entries";
import { enqueue } from "./jobs/queue";
import { watchNotifyJob } from "./jobs/watch";

/** Publie (ou met à jour la forme d') chaque entrée dont la date de publication est passée. */
export async function syncWatchEntries(now = new Date(), entries?: readonly WatchEntry[]) {
  const published = publishedEntries(now, entries);
  for (const e of published) {
    const content = {
      publishedAt: new Date(`${e.publishedAt}T00:00:00.000Z`),
      effectiveDate: new Date(`${e.effectiveAt}T00:00:00.000Z`),
      title: e.title,
      summary: { ...e.summary, source: e.source } as Prisma.InputJsonValue,
      sourceUrl: regulationUrl("fr"),
      impactedControlKeys: e.controls,
      severity: e.severity,
    };
    await prisma.regulatoryUpdate.upsert({
      where: { id: e.id },
      create: { id: e.id, ...content },
      update: content,
    });
  }
  return published.length;
}

/** Synchronise puis programme la notification des entrées dont les administrateurs n'ont pas encore été prévenus. */
export async function scheduleWatchNotifications(
  now = new Date(),
  entries?: readonly WatchEntry[],
) {
  const published = await syncWatchEntries(now, entries);
  const pending = await prisma.regulatoryUpdate.findMany({
    where: { notifiedAt: null, publishedAt: { lte: now } },
    select: { id: true },
  });
  for (const { id } of pending) {
    await enqueue(watchNotifyJob, { entryId: id }, { dedupeKey: `watch.notify:${id}` });
  }
  return { published, scheduled: pending.length };
}
