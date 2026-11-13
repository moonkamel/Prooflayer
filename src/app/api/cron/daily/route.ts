// Passage quotidien (PL-401, PL-404, PL-408), appelé une fois par jour par Vercel Cron (vercel.json). Aucune logique ici :
// authentification puis src/server/system/evaluation-sweep.ts ; le drainage de chaque minute exécute les jobs.
import { isAuthorizedCron } from "@/server/system/cron-auth";
import { scheduleDailySweep } from "@/server/system/evaluation-sweep";
import { scheduleJiraReconciliation } from "@/server/system/jira-schedule";
import { scheduleDailyDigests } from "@/server/system/notification-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new Response(null, { status: 401 });
  }
  const sweep = await scheduleDailySweep();
  // Jira (PL-404) : réconciliation complète et prolongation du webhook de chaque site.
  const jira = await scheduleJiraReconciliation("full");
  // Alertes (PL-408) : résumé quotidien, un email au plus par utilisateur.
  const digests = await scheduleDailyDigests();
  return Response.json({ ...sweep, jira, digests });
}
