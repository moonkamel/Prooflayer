// Routeur `exemption` (PL-205, ajout au §4.4.2) : dossier d'exemption de l'Art. 6(3). Lecture : tout membre ;
// écriture et signature : admin, comme la classification. Aucune logique ici : src/server/services/exemption.ts.
import { z } from "zod";
import { EU_MEMBER_STATES } from "@/server/services/annex-viii";
import * as exemption from "@/server/services/exemption";
import { passwordVerifier } from "@/server/services/session";
import { adminProcedure, orgProcedure, router } from "@/server/trpc";

const systemId = z.string().min(1).max(128);
const text = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

export const exemptionRouter = router({
  get: orgProcedure
    .input(z.object({ systemId }))
    .query(({ ctx, input }) => exemption.getDossier(ctx, input)),
  annexViii: orgProcedure
    .input(z.object({ systemId, format: z.enum(["csv", "json"]) }))
    .query(({ ctx, input }) => exemption.exportAnnexVIIIB(ctx, input)),
  document: orgProcedure
    .input(z.object({ systemId }))
    .query(({ ctx, input }) => exemption.signedDossierData(ctx, input)),
  save: adminProcedure
    .input(
      z.object({
        systemId,
        fields: z.object({
          conditionJustification: text(4000),
          profilingJustification: text(4000),
          providerName: text(200),
          providerAddress: text(500),
          providerContact: text(300),
          submitter: optional(300),
          representative: optional(300),
          tradeName: text(200),
          memberStates: z.array(z.enum(EU_MEMBER_STATES)).max(27),
        }),
      }),
    )
    .mutation(({ ctx, input }) => exemption.saveDossier(ctx, input)),
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
      exemption.signDossier(ctx, input, { verifyPassword: passwordVerifier(ctx.headers) }),
    ),
});
