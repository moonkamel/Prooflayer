// Routeur `classification` (§4.4.2) : draft, saveAnswers, compute, sign, history. Écriture : admin au minimum.
// Ajouts : current (brouillon et version signée, en lecture) et note (données de la note PDF), lisibles par tout
// membre. Aucune logique ici (règle 3 de CLAUDE.md) : src/server/services/classification.ts.
import { z } from "zod";
import { QUESTION_IDS } from "@/server/classify/questionnaire";
import * as classification from "@/server/services/classification";
import { passwordVerifier } from "@/server/services/session";
import { adminProcedure, orgProcedure, router } from "@/server/trpc";

const systemId = z.string().min(1).max(128);

export const classificationRouter = router({
  current: orgProcedure
    .input(z.object({ systemId }))
    .query(({ ctx, input }) => classification.currentClassification(ctx, input)),
  history: orgProcedure
    .input(z.object({ systemId }))
    .query(({ ctx, input }) => classification.classificationHistory(ctx, input)),
  note: orgProcedure
    .input(z.object({ systemId, classificationId: z.string().min(1).max(128) }))
    .query(({ ctx, input }) => classification.classificationNote(ctx, input)),
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
  sign: adminProcedure
    .input(
      z.object({
        systemId,
        name: z.string().trim().min(1).max(120),
        title: z.string().trim().min(1).max(120),
        password: z.string().min(1).max(128),
        locale: z.enum(["fr", "en"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      classification.signClassification(ctx, input, {
        verifyPassword: passwordVerifier(ctx.headers),
      }),
    ),
});
