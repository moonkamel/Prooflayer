// Job `watch.notify` (PL-603) : prévient les administrateurs de chaque organisation d'une entrée du fil de veille.
import { z } from "zod";
import { prisma, withOrgTransaction } from "@/server/db";
import { scheduleNotificationEmail } from "./notifications";
import { defineJob } from "./registry";

const ADMIN_ROLES = new Set(["owner", "admin"]);

/** Membres à prévenir ; remplaçable par les tests (base partagée entre fichiers de tests). */
export const watchAudience = {
  members: () =>
    prisma.member.findMany({
      select: { organizationId: true, userId: true, role: true },
      orderBy: [{ organizationId: "asc" }, { userId: "asc" }],
    }),
};

/**
 * Job `watch.notify` : une notification `watch.published` (et son email) pour chaque owner et admin de chaque
 * organisation. Idempotent : une notification déjà créée pour cette entrée n'est pas recréée ; l'entrée est marquée
 * `notifiedAt` dans la transaction du job.
 */
export const watchNotifyJob = defineJob({
  type: "watch.notify",
  schema: z.object({ entryId: z.string().min(1).max(128) }),
  handle: async ({ entryId }, ctx) => {
    const entry = await ctx.tx.regulatoryUpdate.findUnique({ where: { id: entryId } });
    if (!entry || entry.notifiedAt) return;
    const members = await watchAudience.members();
    const byOrg = new Map<string, string[]>();
    for (const m of members) {
      if (!ADMIN_ROLES.has(m.role)) continue;
      byOrg.set(m.organizationId, [...(byOrg.get(m.organizationId) ?? []), m.userId]);
    }
    const title = entry.title as { fr: string; en: string };
    for (const [orgId, userIds] of byOrg) {
      await withOrgTransaction(orgId, async (tx) => {
        for (const userId of userIds) {
          const exists = await tx.notification.findFirst({
            where: {
              userId,
              type: "watch.published",
              payload: { path: ["entryId"], equals: entryId },
            },
            select: { id: true },
          });
          if (exists) continue;
          const notification = await tx.notification.create({
            data: { orgId, userId, type: "watch.published", payload: { entryId, title } },
          });
          await scheduleNotificationEmail(tx, orgId, notification.id);
        }
      });
    }
    await ctx.tx.regulatoryUpdate.update({
      where: { id: entryId },
      data: { notifiedAt: new Date() },
    });
  },
  timeoutMs: 120_000,
});
