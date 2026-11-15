// Job d'export complet d'une organisation (PL-607) : `org.export`, porteur de l'orgId (RLS). À la dernière tentative
// épuisée, l'export passe FAILED ; le propriétaire peut en demander un autre.
import { z } from "zod";
import {
  buildExport,
  exportStorage,
  failExport,
  type ScheduleExportBuild,
} from "@/server/services/org-export";
import { scheduleNotificationEmail } from "./notifications";
import { enqueueInTransaction } from "./queue";
import { defineJob } from "./registry";

const MAX_ATTEMPTS = 3;

export const orgExportJob = defineJob({
  type: "org.export",
  schema: z.object({ exportId: z.string().min(1).max(128) }),
  timeoutMs: 240_000,
  maxAttempts: MAX_ATTEMPTS,
  handle: async ({ exportId }, ctx) => {
    if (!ctx.job.orgId) throw new Error("org.export sans organisation");
    await ctx.tx.orgExport.updateMany({
      where: { id: exportId, orgId: ctx.job.orgId, status: "QUEUED" },
      data: { status: "BUILDING" },
    });
    try {
      await buildExport(
        ctx.tx,
        ctx.job.orgId,
        exportId,
        exportStorage.get(),
        scheduleNotificationEmail,
      );
    } catch (error) {
      if (ctx.job.attempts < MAX_ATTEMPTS) throw error;
      await failExport(ctx.tx, ctx.job.orgId, exportId);
    }
  },
});

export const scheduleExportBuild: ScheduleExportBuild = (tx, orgId, exportId) =>
  enqueueInTransaction(
    tx,
    orgExportJob,
    { exportId },
    { orgId, dedupeKey: `org.export:${exportId}` },
  );
