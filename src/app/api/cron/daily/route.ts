// Passage quotidien (PL-401, PL-404), appelé une fois par jour par Vercel Cron (vercel.json). Aucune logique ici :
// authentification puis src/server/system/evaluation-sweep.ts ; le drainage de chaque minute exécute les jobs.
import { isAuthorizedCron } from "@/server/system/cron-auth";
import { scheduleDailySweep } from "@/server/system/evaluation-sweep";
import { scheduleJiraReconciliation } from "@/server/system/jira-schedule";

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
  return Response.json({ ...sweep, jira });
}
