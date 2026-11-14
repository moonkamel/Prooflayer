// Routeur `pack` (§4.4.2) : create (admin), list, get, downloadUrl (tout membre, auditeur compris), preview (aperçu
// chiffré de l'écran E), download (contenu, pour la route de téléchargement). Aucune logique ici : src/server/services/packs.ts.
import { z } from "zod";
import * as packs from "@/server/services/packs";
import { schedulePackBuild } from "@/server/system/jobs/pack";
import { adminProcedure, orgProcedure, router } from "@/server/trpc";

const id = z.string().min(1).max(128);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const packRouter = router({
  create: adminProcedure
    .input(
      z.object({ systemId: id, periodStart: day, periodEnd: day, language: z.enum(["fr", "en"]) }),
    )
    .mutation(({ ctx, input }) => packs.createPack(ctx, input, schedulePackBuild)),
  list: orgProcedure
    .input(z.object({ systemId: id }))
    .query(({ ctx, input }) => packs.listPacks(ctx, input)),
  get: orgProcedure
    .input(z.object({ packId: id }))
    .query(({ ctx, input }) => packs.getPack(ctx, input)),
  downloadUrl: orgProcedure
    .input(z.object({ packId: id }))
    .query(({ ctx, input }) => packs.packDownloadUrl(ctx, input)),
  /** Contenu de l'archive pour la route `/api/packs/[id]/download` (appel serveur, journalisé). */
  download: orgProcedure
    .input(z.object({ packId: id }))
    .query(({ ctx, input }) => packs.downloadPack(ctx, input)),
  preview: orgProcedure
    .input(z.object({ systemId: id, periodStart: day, periodEnd: day }))
    .query(({ ctx, input }) => packs.packPreview(ctx, input)),
});
