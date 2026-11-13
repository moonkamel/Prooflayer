// Job de génération d'un pack d'audit (PL-504) : `pack.build`, porteur de l'orgId (RLS). Moins de 3 minutes pour
// 2 000 preuves (§3.2 E9), sous le bail de 5 minutes. Une panne passagère relance le job ; à la dernière tentative,
// le pack passe FAILED.
import { z } from "zod";
import {
  buildPack,
  defaultPackDependencies,
  type PackDependencies,
  type SchedulePackBuild,
} from "@/server/services/packs";
import { enqueueInTransaction } from "./queue";
import { defineJob } from "./registry";

/** Dépendances du job ; remplaçables par les tests. */
export const packJobDependencies: { get: () => PackDependencies } = {
  get: defaultPackDependencies,
};

export const packBuildJob = defineJob({
  type: "pack.build",
  schema: z.object({ packId: z.string().min(1).max(128) }),
  timeoutMs: 240_000,
  handle: async ({ packId }, ctx) => {
    if (!ctx.job.orgId) throw new Error("pack.build sans organisation");
    await buildPack(ctx.tx, ctx.job.orgId, packId, packJobDependencies.get(), {
      current: ctx.job.attempts,
      max: 4,
    });
  },
  maxAttempts: 4,
});

export const schedulePackBuild: SchedulePackBuild = (tx, orgId, packId) =>
  enqueueInTransaction(tx, packBuildJob, { packId }, { orgId, dedupeKey: `pack.build:${packId}` });
