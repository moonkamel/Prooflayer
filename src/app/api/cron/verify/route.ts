// Revérification quotidienne de la chaîne (PL-503), appelée chaque jour par Vercel Cron (vercel.json). Aucune logique ici : authentification
// puis src/server/system/seal-schedule.ts ; le drainage de chaque minute exécute les jobs.
import { isAuthorizedCron } from "@/server/system/cron-auth";
import { scheduleChainVerification } from "@/server/system/seal-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new Response(null, { status: 401 });
  }
  return Response.json(await scheduleChainVerification());
}
