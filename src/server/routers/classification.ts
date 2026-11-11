// Routeur `classification` (§4.4.2) : draft, saveAnswers, compute. Écriture : admin au minimum.
// sign et history arrivent avec PL-204. Aucune logique ici (règle 3 de CLAUDE.md) : src/server/services/classification.ts.
import { z } from "zod";
import { QUESTION_IDS } from "@/server/classify/questionnaire";
import * as classification from "@/server/services/classification";
import { adminProcedure, router } from "@/server/trpc";

const systemId = z.string().min(1).max(128);

export const classificationRouter = router({
  draft: adminProcedure
    .input(z.object({ systemId }))
    .mutation(({ ctx, input }) => classification.openDraft(ctx, input)),
  saveAnswers: adminProcedure
    .input(
      z.object({
        systemId,
        questionId: z.enum(QUESTION_IDS),
        value: z.union([z.boolean(), z.array(z.string().max(32)).max(40)]),
      }),
    )
    .mutation(({ ctx, input }) => classification.saveAnswer(ctx, input)),
  compute: adminProcedure
    .input(z.object({ systemId }))
    .mutation(({ ctx, input }) => classification.computeDraft(ctx, input)),
});
