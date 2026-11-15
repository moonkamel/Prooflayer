// Routeur `onboarding` (PL-604) : progression de la mise en route et capture en direct, lecture pour tout membre.
// Aucune logique ici : src/server/services/onboarding.ts.
import { z } from "zod";
import { liveCapture, onboardingProgress } from "@/server/services/onboarding";
import { orgProcedure, router } from "@/server/trpc";

export const onboardingRouter = router({
  progress: orgProcedure.query(({ ctx }) => onboardingProgress(ctx)),
  capture: orgProcedure
    .input(z.object({ systemId: z.string().min(1).max(128) }))
    .query(({ ctx, input }) => liveCapture(ctx, input)),
});
