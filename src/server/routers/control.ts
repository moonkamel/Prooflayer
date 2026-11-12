// Routeur `control` (§4.4.2). PL-207 : listBySystem ; PL-407 : get, evaluations (lecture, tout membre), assignOwner
// et comment (contributor), setNotApplicable (admin). Aucune logique ici : src/server/services/controls.ts et
// src/server/services/control-detail.ts.
import { z } from "zod";
import * as controls from "@/server/services/controls";
import * as detail from "@/server/services/control-detail";
import {
  COMMENT_MAX,
  NA_JUSTIFICATION_MAX,
  NA_JUSTIFICATION_MIN,
} from "@/server/services/control-detail-data";
import { adminProcedure, orgProcedure, router, writeProcedure } from "@/server/trpc";

const id = z.string().min(1).max(128);

export const controlRouter = router({
  listBySystem: orgProcedure
    .input(z.object({ systemId: id }))
    .query(({ ctx, input }) => controls.listControlsBySystem(ctx, input)),
  get: orgProcedure
    .input(z.object({ controlId: id, page: z.number().int().min(1).max(10_000).optional() }))
    .query(({ ctx, input }) => detail.getControl(ctx, input)),
  evaluations: orgProcedure
    .input(z.object({ controlId: id, limit: z.number().int().min(1).max(200).optional() }))
    .query(({ ctx, input }) => detail.listEvaluations(ctx, input)),
  assignOwner: writeProcedure
    .input(z.object({ controlId: id, ownerUserId: id.nullable() }))
    .mutation(({ ctx, input }) => detail.assignOwner(ctx, input)),
  setNotApplicable: adminProcedure
    .input(
      z
        .object({
          controlId: id,
          notApplicable: z.boolean(),
          justification: z.string().trim().max(NA_JUSTIFICATION_MAX).nullable().optional(),
        })
        .refine((v) => !v.notApplicable || (v.justification ?? "").length >= NA_JUSTIFICATION_MIN, {
          message: "control.justificationRequired",
          path: ["justification"],
        }),
    )
    .mutation(({ ctx, input }) => detail.setNotApplicable(ctx, input)),
  comment: writeProcedure
    .input(z.object({ controlId: id, body: z.string().trim().min(1).max(COMMENT_MAX) }))
    .mutation(({ ctx, input }) => detail.addComment(ctx, input)),
});
