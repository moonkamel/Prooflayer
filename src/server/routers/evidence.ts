// Routeur `evidence` (§4.4.2, rôle contributor en écriture). PL-405 : `createUploadUrl`, `registerUpload`, `attest`.
// PL-503 : `proof` (lecture, tout membre). list, get et redact arrivent avec le pack (PL-504) et l'effacement (PL-507). Aucune
// logique ici : src/server/services/manual-evidence.ts.
import { z } from "zod";
import { evidenceProof } from "@/server/services/evidence-proof";
import * as manual from "@/server/services/manual-evidence";
import { passwordVerifier } from "@/server/services/session";
import { orgProcedure, router, writeProcedure } from "@/server/trpc";

const controls = z.array(z.string().min(1).max(128)).min(1).max(20);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const evidenceRouter = router({
  proof: orgProcedure
    .input(z.object({ evidenceId: z.string().min(1).max(128) }))
    .query(({ ctx, input }) => evidenceProof(ctx, input)),
  createUploadUrl: writeProcedure
    .input(
      z.object({
        controlInstanceIds: controls,
        filename: z.string().trim().min(1).max(200),
        contentType: z.string().min(1).max(120),
        size: z.number().int().positive(),
      }),
    )
    .mutation(({ ctx, input }) => manual.createUploadUrl(ctx, input)),
  registerUpload: writeProcedure
    .input(
      z.object({
        token: z.string().min(1).max(4096),
        validUntil: date,
        title: z.string().trim().max(200).nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => manual.registerUpload(ctx, input)),
  attest: writeProcedure
    .input(
      z.object({
        controlInstanceIds: controls,
        statement: z.string().trim().min(10).max(4000),
        name: z.string().trim().min(1).max(120),
        title: z.string().trim().min(1).max(120),
        validUntil: date,
        password: z.string().min(1).max(256),
      }),
    )
    .mutation(({ ctx, input }) =>
      manual.attest(ctx, input, { verifyPassword: passwordVerifier(ctx.headers) }),
    ),
});
