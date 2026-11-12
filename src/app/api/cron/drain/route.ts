// Drainage de la file de jobs (PL-107), appelé chaque minute par Vercel Cron (vercel.json).
// Aucune logique ici : authentification puis src/server/system/jobs/queue.ts.
import { isAuthorizedCron } from "@/server/system/cron-auth";
import { jobRegistry } from "@/server/system/jobs/handlers";
import { drainJobs } from "@/server/system/jobs/queue";
import { drainDeliveries } from "@/server/ingest/process-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new Response(null, { status: 401 });
  }
  // Livraisons de webhooks en attente ou abandonnées d'abord (PL-302), puis la file de jobs.
  const deliveries = await drainDeliveries();
  const stats = await drainJobs(jobRegistry, { budgetMs: 45_000 });
  return Response.json({ ...stats, deliveries });
}
