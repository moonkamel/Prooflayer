// Programmation Jira (PL-404, §4.5.2) : réconciliation de chaque intégration Jira active toutes les 15 minutes
// (`incremental`), en entier chaque jour (`full`) avec la prolongation du webhook. La révocation côté Atlassian est
// détectée au premier rafraîchissement de jeton, donc en moins de 30 minutes (§3.2 E4).
import { prisma, withOrgTransaction } from "@/server/db";
import { jiraReconcileJob, jiraWebhookEnsureJob } from "./jobs/jira";
import { enqueue } from "./jobs/queue";

const QUARTER_MS = 15 * 60_000;

export async function scheduleJiraReconciliation(mode: "incremental" | "full", now = new Date()) {
  const slot =
    mode === "full"
      ? now.toISOString().slice(0, 10)
      : String(Math.floor(now.getTime() / QUARTER_MS));
  const orgs = await prisma.organization.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  let scheduled = 0;
  for (const { id: orgId } of orgs) {
    const integrations = await withOrgTransaction(orgId, (tx) =>
      tx.integration.findMany({
        where: { provider: "JIRA", status: "ACTIVE" },
        select: { id: true },
      }),
    );
    for (const { id } of integrations) {
      const result = await enqueue(
        jiraReconcileJob,
        { integrationId: id, mode },
        { orgId, dedupeKey: `jira.reconcile:${id}:${mode}:${slot}` },
      );
      if (!result.deduplicated) scheduled += 1;
      if (mode === "full") {
        await enqueue(
          jiraWebhookEnsureJob,
          { integrationId: id },
          { orgId, dedupeKey: `jira.webhook.ensure:${id}:${slot}` },
        );
      }
    }
  }
  return { mode, scheduled };
}

/** Rattrapage complet à l'enregistrement d'une correspondance, puis vérification du webhook. */
export async function scheduleFullReconcile(orgId: string, integrationId: string) {
  await enqueue(jiraReconcileJob, { integrationId, mode: "full" as const }, { orgId });
  await enqueue(
    jiraWebhookEnsureJob,
    { integrationId },
    { orgId, runAt: new Date(Date.now() + 5 * 60_000) },
  );
}
