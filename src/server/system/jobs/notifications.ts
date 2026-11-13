// Jobs d'alerte (PL-408) : `notification.email` envoie l'email d'une régression (job porteur de l'orgId, RLS) ;
// `notification.digest` envoie le résumé quotidien d'un utilisateur, toutes organisations réunies (sans orgId : la
// transaction positionne app.org_id organisation par organisation). Les deux sont idempotents (`emailedAt`, marque
// `digest.daily` du jour).
import { z } from "zod";
import {
  sendDailyDigest,
  sendNotificationEmail,
  type ScheduleNotificationEmail,
} from "@/server/services/notifications";
import { enqueueInTransaction } from "./queue";
import { defineJob } from "./registry";

export const notificationEmailJob = defineJob({
  type: "notification.email",
  schema: z.object({ notificationId: z.string().min(1).max(128) }),
  handle: async ({ notificationId }, ctx) => {
    if (!ctx.job.orgId) throw new Error("notification.email sans organisation");
    await sendNotificationEmail(ctx.tx, ctx.job.orgId, notificationId);
  },
});

/** Programme l'email d'une alerte dans la transaction qui la crée. */
export const scheduleNotificationEmail: ScheduleNotificationEmail = (tx, orgId, notificationId) =>
  enqueueInTransaction(
    tx,
    notificationEmailJob,
    { notificationId },
    { orgId, dedupeKey: `notification.email:${notificationId}` },
  );

export const notificationDigestJob = defineJob({
  type: "notification.digest",
  schema: z.object({
    userId: z.string().min(1).max(128),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  }),
  handle: async (payload, ctx) => {
    await sendDailyDigest(ctx.tx, payload);
  },
});

export const digestDedupeKey = (userId: string, day: string) =>
  `notification.digest:${userId}:${day}`;
