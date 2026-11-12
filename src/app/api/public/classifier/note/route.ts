// Classifieur public (PL-208) : demande de la note PDF, sans compte. Logique dans
// src/server/services/public-classifier.ts ; l'envoi passe par la file de jobs (exécution immédiate, cron en filet).
import { ServiceError } from "@/server/services/errors";
import { clientIp } from "@/server/services/audit";
import { noteRequestSchema, requestNote } from "@/server/services/public-classifier";
import { jobRegistry } from "@/server/system/jobs/handlers";
import { publicClassifierNoteJob } from "@/server/system/jobs/public-classifier-note";
import { enqueue } from "@/server/system/jobs/queue";

export const runtime = "nodejs";

const STATUS: Record<string, number> = { BAD_REQUEST: 400, TOO_MANY_REQUESTS: 429 };

export async function POST(request: Request): Promise<Response> {
  const parsed = noteRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "publicClassifier.invalid" }, { status: 400 });
  try {
    const lead = await requestNote(parsed.data, { ip: clientIp(request.headers) });
    await enqueue(
      publicClassifierNoteJob,
      { leadId: lead.id },
      {
        dedupeKey: `publicClassifier.sendNote:${lead.id}`,
        runNow: { registry: jobRegistry },
      },
    );
    return Response.json({ ok: true }, { status: 202 });
  } catch (error) {
    if (error instanceof ServiceError && STATUS[error.code]) {
      return Response.json({ error: error.reason }, { status: STATUS[error.code] });
    }
    throw error;
  }
}
