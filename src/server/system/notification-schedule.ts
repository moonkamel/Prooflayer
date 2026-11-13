// Résumé quotidien (PL-408, §3.2 E12) : un job `notification.digest` par utilisateur membre d'au moins une
// organisation et par jour (clé datée : au plus un email par jour et par utilisateur), programmé à DIGEST_HOUR_UTC,
// après le passage quotidien d'évaluation. Appelé par le cron quotidien (`/api/cron/daily`).
import { prisma } from "@/server/db";
import { digestDay, digestRunAt } from "@/server/services/notifications-data";
import { digestDedupeKey, notificationDigestJob } from "./jobs/notifications";
import { enqueue } from "./jobs/queue";

export async function scheduleDailyDigests(now: Date = new Date()) {
  const day = digestDay(now);
  const runAt = digestRunAt(day);
  const users = await prisma.member.findMany({
    distinct: ["userId"],
    select: { userId: true },
    orderBy: { userId: "asc" },
  });
  let scheduled = 0;
  for (const { userId } of users) {
    const result = await enqueue(
      notificationDigestJob,
      { userId, day },
      { dedupeKey: digestDedupeKey(userId, day), runAt },
    );
    if (!result.deduplicated) scheduled += 1;
  }
  return { day, users: users.length, scheduled };
}
