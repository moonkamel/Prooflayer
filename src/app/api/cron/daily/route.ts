// Passage quotidien (PL-401, PL-404, PL-408, PL-603), appelé une fois par jour par Vercel Cron (vercel.json). Aucune logique ici :
// authentification puis src/server/system/evaluation-sweep.ts ; le drainage de chaque minute exécute les jobs.
import { isAuthorizedCron } from "@/server/system/cron-auth";
import { scheduleDailySweep } from "@/server/system/evaluation-sweep";
import { scheduleJiraReconciliation } from "@/server/system/jira-schedule";
import { scheduleDailyDigests } from "@/server/system/notification-schedule";
import { scheduleWatchNotifications } from "@/server/system/regulatory-watch";
import { pruneRateLimits } from "@/server/system/rate-limit";
import { prunePublicLeads } from "@/server/system/public-leads";
import { scheduleOrgDeletions } from "@/server/system/org-deletion-schedule";
import { syncAllFunnels } from "@/server/system/funnel";

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
  // Veille (PL-603) : entrées publiées ce jour, administrateurs prévenus une fois.
  const watch = await scheduleWatchNotifications();
  // PL-605 : compteurs de limitation de débit périmés.
  const rateLimits = await pruneRateLimits();
  // PL-606 : demandes du classifieur public au-delà de la durée annoncée par la politique de confidentialité.
  const publicLeads = await prunePublicLeads();
  // PL-607 : avis de fin de contrat (purge à 90 jours) et purges arrivées à échéance.
  const deletions = await scheduleOrgDeletions();
  // PL-608 : étapes de l'entonnoir atteintes (et transmises à PostHog s'il est configuré).
  const funnel = (await syncAllFunnels()).created;
  return Response.json({
    ...sweep,
    jira,
    digests,
    watch,
    rateLimits,
    publicLeads,
    deletions,
    funnel,
  });
}
