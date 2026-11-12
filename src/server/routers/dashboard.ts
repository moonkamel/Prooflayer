// Routeur `dashboard` (§4.4.2, lecture, tout membre) : orgSummary, systemSummary, coverageTimeline (PL-406).
// Aucune logique ici : src/server/services/dashboard.ts.
import { z } from "zod";
import * as dashboard from "@/server/services/dashboard";
import { orgProcedure, router } from "@/server/trpc";

const system = z.object({ systemId: z.string().min(1).max(128) });

export const dashboardRouter = router({
  orgSummary: orgProcedure.query(({ ctx }) => dashboard.orgSummary(ctx)),
  systemSummary: orgProcedure
    .input(system)
    .query(({ ctx, input }) => dashboard.systemSummary(ctx, input)),
  coverageTimeline: orgProcedure
    .input(system)
    .query(({ ctx, input }) => dashboard.systemCoverageTimeline(ctx, input)),
});
