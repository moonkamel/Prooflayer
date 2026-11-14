// Routeur `billing` (PL-601, §3.2 E11) : lecture pour tout membre ; souscription et portail réservés au owner.
// Aucune logique ici : src/server/services/billing.ts.
import { z } from "zod";
import { INTERVALS, PAID_PLANS } from "@/server/services/billing-data";
import { getBilling, openPortal, startCheckout } from "@/server/services/billing";
import { orgProcedure, router, withRole } from "@/server/trpc";

const ownerProcedure = withRole("owner");

export const billingRouter = router({
  get: orgProcedure.query(({ ctx }) => getBilling(ctx)),
  checkout: ownerProcedure
    .input(
      z.object({
        plan: z.enum(PAID_PLANS),
        interval: z.enum(INTERVALS),
        locale: z.enum(["fr", "en"]).default("fr"),
      }),
    )
    .mutation(({ ctx, input }) => startCheckout(ctx, input)),
  portal: ownerProcedure.mutation(({ ctx }) => openPortal(ctx)),
});
