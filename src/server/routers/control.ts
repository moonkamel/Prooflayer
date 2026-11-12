// Routeur `control` (§4.4.2). PL-207 livre listBySystem ; get, assignOwner, setNotApplicable et evaluations
// arrivent avec le moteur d'évaluation et l'écran D (sprint 4). Aucune logique ici : src/server/services/controls.ts.
import { z } from "zod";
import * as controls from "@/server/services/controls";
import { orgProcedure, router } from "@/server/trpc";

export const controlRouter = router({
  listBySystem: orgProcedure
    .input(z.object({ systemId: z.string().min(1).max(128) }))
    .query(({ ctx, input }) => controls.listControlsBySystem(ctx, input)),
});
