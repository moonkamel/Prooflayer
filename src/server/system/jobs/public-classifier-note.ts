// Job d'envoi de la note du classifieur public (PL-208). L'envoi est rejoué en cas d'échec (file de PL-107).
import { z } from "zod";
import { sendLeadNote } from "@/server/services/public-classifier";
import { defineJob } from "./registry";

export const publicClassifierNoteJob = defineJob({
  type: "publicClassifier.sendNote",
  schema: z.object({ leadId: z.string().min(1).max(128) }),
  handle: ({ leadId }, ctx) => sendLeadNote(leadId, ctx.tx),
});
