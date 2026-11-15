// Surveillance d'exploitation (PL-609), toutes les 15 minutes (vercel.json). Aucune logique ici : authentification
// puis src/server/system/monitoring.ts (constats et alertes Sentry, sans donnée client).
import { isAuthorizedCron } from "@/server/system/cron-auth";
import { runMonitoring } from "@/server/system/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new Response(null, { status: 401 });
  }
  return Response.json(await runMonitoring());
}
