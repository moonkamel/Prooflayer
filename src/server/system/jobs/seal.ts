// Jobs de scellement (PL-501) et d'ancrage (PL-502). Scellement horaire : `seal.org` scelle les preuves en attente d'une organisation, par lots de
// SEAL_MAX_LEAVES au plus (plusieurs lots si un rattrapage en a laissé davantage). Job porteur de l'orgId (RLS).
import { z } from "zod";
import { SEAL_MAX_LEAVES, sealOrg } from "@/server/services/seal";
import { anchorPendingBatches, defaultTimestamper, type Timestamper } from "../anchoring";
import { defineJob } from "./registry";

/** Lots au plus par exécution : la tentative reste loin du bail de 5 minutes. */
const MAX_BATCHES_PER_RUN = 4;

export const sealOrgJob = defineJob({
  type: "seal.org",
  schema: z.object({ hour: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}$/u) }),
  timeoutMs: 120_000,
  handle: async (_payload, ctx) => {
    if (!ctx.job.orgId) throw new Error("seal.org sans organisation");
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const batch = await sealOrg(ctx.tx, ctx.job.orgId, new Date());
      if (!batch || batch.leafCount < SEAL_MAX_LEAVES) return;
    }
  },
});

/** Job `seal.anchor` (sans organisation) : ancre les lots en attente ; une panne du prestataire relance le job. */
export const sealAnchorJob = defineJob({
  type: "seal.anchor",
  schema: z.object({ window: z.string().min(1).max(40) }),
  timeoutMs: 60_000,
  handle: async (_payload, ctx) => {
    await anchorPendingBatches(ctx.tx, new Date(), anchorTimestamper());
  },
});

/** Prestataire utilisé par le job ; remplaçable par les tests. */
export const anchorDependencies: { timestamper: () => Timestamper } = {
  timestamper: defaultTimestamper,
};
const anchorTimestamper = () => anchorDependencies.timestamper();
