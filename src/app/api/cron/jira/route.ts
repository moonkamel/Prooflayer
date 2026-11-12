// Réconciliation Jira toutes les 15 minutes (PL-404, vercel.json). Aucune logique ici : src/server/system/jira-schedule.ts ;
// le drainage de chaque minute exécute les jobs.
import { isAuthorizedCron } from "@/server/system/cron-auth";
import { scheduleJiraReconciliation } from "@/server/system/jira-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new Response(null, { status: 401 });
  }
  return Response.json(await scheduleJiraReconciliation("incremental"));
}
