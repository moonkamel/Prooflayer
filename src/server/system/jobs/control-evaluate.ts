// Jobs d'évaluation des contrôles (PL-401) : `control.evaluate` évalue un contrôle d'un système ; `control.sweepOrg`
// est le passage quotidien d'une organisation (péremption, fenêtres glissantes), qui programme chacun de ses
// contrôles évaluables. Les deux s'exécutent avec app.org_id positionné (job porteur d'un orgId).
import { z } from "zod";
import {
  EVALUATION_JOB,
  evaluateInstance,
  evaluationDedupeKey,
  scheduleOrgSweep,
  type ScheduleEvaluation,
} from "@/server/services/evaluation";
import { enqueueInTransaction } from "./queue";
import { defineJob } from "./registry";

export const controlEvaluateJob = defineJob({
  type: EVALUATION_JOB,
  schema: z.object({ controlInstanceId: z.string().min(1).max(128) }),
  handle: async ({ controlInstanceId }, ctx) => {
    if (!ctx.job.orgId) throw new Error("control.evaluate sans organisation");
    await evaluateInstance(ctx.tx, ctx.job.orgId, controlInstanceId, new Date());
  },
});

/** Programme `control.evaluate` dans la transaction en cours, dédupliqué par contrôle tant qu'il attend. */
export const scheduleEvaluation: ScheduleEvaluation = (tx, orgId, controlInstanceId) =>
  enqueueInTransaction(
    tx,
    controlEvaluateJob,
    { controlInstanceId },
    { orgId, dedupeKey: evaluationDedupeKey(controlInstanceId) },
  );

export const controlSweepOrgJob = defineJob({
  type: "control.sweepOrg",
  schema: z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u) }),
  handle: async (_payload, ctx) => {
    if (!ctx.job.orgId) throw new Error("control.sweepOrg sans organisation");
    await scheduleOrgSweep(ctx.tx, ctx.job.orgId, scheduleEvaluation);
  },
});
