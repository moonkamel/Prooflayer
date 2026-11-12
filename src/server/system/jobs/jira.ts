// Jobs Jira (PL-404, §4.5.2) : `jira.issue.sync` relit un ticket (webhook ou réconciliation), `jira.reconcile`
// interroge les correspondances (toutes les 15 minutes, ou en entier au rattrapage et chaque jour),
// `jira.webhook.ensure` enregistre ou prolonge le webhook du site. Effets réseau en lecture (et gestion du webhook) :
// une tentative rejouée relit les mêmes tickets, les preuves sont dédupliquées.
import { z } from "zod";
import { jiraDependencies } from "@/server/services/jira-integration";
import { ensureWebhook, reconcile, syncIssue, type JiraDeps } from "@/server/services/jira-sync";
import { scheduleEvaluation } from "./control-evaluate";
import { enqueueInTransaction } from "./queue";
import { defineJob } from "./registry";

/** Dépendances des jobs Jira ; remplaçables par les tests (Atlassian simulé). */
export const jiraJobDependencies: { current: () => JiraDeps } = {
  current: () => jiraDependencies(),
};

const integrationOf = async (tx: Parameters<typeof syncIssue>[0], integrationId: string) =>
  tx.integration.findUnique({
    where: { id: integrationId },
    select: { status: true, externalAccountId: true },
  });

export const jiraIssueSyncJob = defineJob({
  type: "jira.issue.sync",
  schema: z.object({
    integrationId: z.string().min(1).max(128),
    issueKey: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/u),
    capturedVia: z.enum(["WEBHOOK", "BACKFILL"]).default("WEBHOOK"),
  }),
  handle: async ({ integrationId, issueKey, capturedVia }, ctx) => {
    if (!ctx.job.orgId) throw new Error("jira.issue.sync sans organisation");
    const integration = await integrationOf(ctx.tx, integrationId);
    if (integration?.status !== "ACTIVE") return;
    await syncIssue(
      ctx.tx,
      { orgId: ctx.job.orgId, integrationId, issueKey, capturedVia },
      jiraJobDependencies.current(),
      scheduleEvaluation,
    );
  },
});

export const jiraReconcileJob = defineJob({
  type: "jira.reconcile",
  schema: z.object({
    integrationId: z.string().min(1).max(128),
    mode: z.enum(["incremental", "full"]),
  }),
  handle: async ({ integrationId, mode }, ctx) => {
    const orgId = ctx.job.orgId;
    if (!orgId) throw new Error("jira.reconcile sans organisation");
    const integration = await integrationOf(ctx.tx, integrationId);
    if (integration?.status !== "ACTIVE") return;
    await reconcile(
      ctx.tx,
      { orgId, integrationId, mode },
      jiraJobDependencies.current(),
      (tx, org, id, issueKey) =>
        enqueueInTransaction(
          tx,
          jiraIssueSyncJob,
          {
            integrationId: id,
            issueKey,
            capturedVia: mode === "full" ? ("BACKFILL" as const) : ("WEBHOOK" as const),
          },
          { orgId: org, dedupeKey: `jira.issue.sync:${id}:${issueKey}` },
        ),
    );
  },
  timeoutMs: 120_000,
});

export const jiraWebhookEnsureJob = defineJob({
  type: "jira.webhook.ensure",
  schema: z.object({ integrationId: z.string().min(1).max(128) }),
  handle: async ({ integrationId }, ctx) => {
    const orgId = ctx.job.orgId;
    if (!orgId) throw new Error("jira.webhook.ensure sans organisation");
    const integration = await integrationOf(ctx.tx, integrationId);
    if (integration?.status !== "ACTIVE" || !process.env.BETTER_AUTH_URL) return;
    const url = new URL(
      `/api/webhooks/jira/${integration.externalAccountId}`,
      process.env.BETTER_AUTH_URL,
    ).toString();
    await ensureWebhook(ctx.tx, { orgId, integrationId, url }, jiraJobDependencies.current());
  },
});
