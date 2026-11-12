// Routeur `evidence` (§4.4.2, rôle contributor en écriture). PL-405 : `createUploadUrl`, `registerUpload`, `attest`.
// list, get, proof et redact arrivent avec l'écran D (PL-407), le scellement (sprint 5) et l'effacement. Aucune
// logique ici : src/server/services/manual-evidence.ts.
import { z } from "zod";
import * as manual from "@/server/services/manual-evidence";
import { passwordVerifier } from "@/server/services/session";
import { router, writeProcedure } from "@/server/trpc";

const controls = z.array(z.string().min(1).max(128)).min(1).max(20);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const evidenceRouter = router({
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
