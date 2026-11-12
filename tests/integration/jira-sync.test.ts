// PL-404 — Correspondances, synchronisation et webhook Jira sur base réelle, Atlassian simulé : prévisualisation,
// enregistrement, rattrapage complet, preuves jira.issue.*, sortie de correspondance, webhook unique par site
// (enregistré, prolongé, réenregistré quand les projets changent), réception d'un webhook jusqu'à la preuve.
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKey, type MasterKey } from "@/server/crypto/envelope";
import { forOrg, prisma, withOrgTransaction } from "@/server/db";
import { signState } from "@/server/connectors/jira/oauth";
import {
  completeJiraAuthorization,
  type JiraDependencies,
} from "@/server/services/jira-integration";
import { previewJiraQuery, saveJiraMapping } from "@/server/services/jira-mappings";
import { ensureWebhook, syncIssue } from "@/server/services/jira-sync";
import { scheduleEvaluation } from "@/server/system/jobs/control-evaluate";
import { jobRegistry } from "@/server/system/jobs/handlers";
import { jiraJobDependencies, jiraReconcileJob } from "@/server/system/jobs/jira";
import { enqueue, runJobNow } from "@/server/system/jobs/queue";
import type { OrgContext } from "@/server/services/organization";

const run = randomUUID().slice(0, 8);
const A = `org_jsync_${run}`;
const owner = `usr_jsync_${run}`;
const CLOUD = randomUUID();
const SECRET = "secret-client-jira-test";
const master: MasterKey = { id: "test", key: generateKey() };
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(join(__dirname, "..", "fixtures", "jira", "issue", `${name}.json`), "utf8"),
  );

/** Atlassian simulé : jetons, tickets, recherche JQL élémentaire, webhooks dynamiques. */
class FakeJira {
  clock = new Date("2026-11-12T10:00:00Z");
  issues = new Map<string, Record<string, unknown>>([
    ["AIR-12", fixture("risk-1")],
    ["AIR-40", fixture("incident-1")],
    ["OPS-7", fixture("review-1")],
  ]);
  webhooks: { id: number; jqlFilter: string; url: string }[] = [];
  refreshed: number[] = [];
  deleted: number[] = [];
  private seq = 0;

  private matches(query: string, issue: Record<string, unknown>): boolean {
    const f = issue.fields as { labels?: string[]; issuetype: { name: string } };
    const label = query.match(/^labels = ([\w-]+)$/u);
    if (label) return (f.labels ?? []).includes(label[1]!);
    const type = query.match(/^issuetype = "([^"]+)"$/u);
    if (type) return f.issuetype.name === type[1];
    throw new Error("JQL");
  }

  private search(jql: string) {
    const byKey = jql.match(/^key = ([A-Z]+-\d+) AND \((.+)\)$/u);
    if (byKey) {
      const issue = this.issues.get(byKey[1]!);
      return issue && this.matches(byKey[2]!, issue) ? [issue] : [];
    }
    const query = jql.replace(/^\((.+)\) AND updated >= "-20m"$/u, "$1");
    return [...this.issues.values()].filter((i) => this.matches(query, i));
  }

  fetch = (async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(init.body as string) : {};
    if (url === "https://auth.atlassian.com/oauth/token") {
      return Response.json({
        access_token: `acc-${++this.seq}`,
        refresh_token: `ref-${this.seq}`,
        expires_in: 3600,
        scope: "read:jira-work read:jira-user manage:jira-webhook offline_access",
      });
    }
    if (url.endsWith("/oauth/token/accessible-resources")) {
      return Response.json([
        {
          id: CLOUD,
          name: "talvio",
          url: "https://talvio.atlassian.net",
          scopes: ["read:jira-work", "read:jira-user", "manage:jira-webhook"],
        },
      ]);
    }
    const path = url.replace(`https://api.atlassian.com/ex/jira/${CLOUD}/rest/api/3`, "");
    try {
      if (path.startsWith("/issue/")) {
        const key = path.slice("/issue/".length).split("?")[0]!;
        const issue = this.issues.get(key);
        return issue ? Response.json(issue) : new Response(null, { status: 404 });
      }
      if (path === "/search/jql") {
        const found = this.search(body.jql).slice(0, body.maxResults);
        return Response.json({
          issues: found.map((i) => ({ id: i.id, key: i.key })),
          isLast: true,
        });
      }
      if (path === "/search/approximate-count")
        return Response.json({ count: this.search(body.jql).length });
    } catch {
      return Response.json({ errorMessages: ["JQL invalide"] }, { status: 400 });
    }
    if (path === "/webhook" && init.method === "POST") {
      const id = 9000 + this.webhooks.length;
      this.webhooks.push({ id, jqlFilter: body.webhooks[0].jqlFilter, url: body.url });
      return Response.json({ webhookRegistrationResult: [{ createdWebhookId: id }] });
    }
    if (path === "/webhook/refresh") {
      this.refreshed.push(...body.webhookIds);
      return Response.json({
        expirationDate: new Date(this.clock.getTime() + 30 * 86_400_000).toISOString(),
      });
    }
    if (path === "/webhook" && init.method === "DELETE") {
      this.deleted.push(...body.webhookIds);
      return new Response(null, { status: 202 });
    }
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
}

const jira = new FakeJira();
const deps: JiraDependencies = {
  fetch: jira.fetch,
  master,
  now: () => jira.clock,
  stateSecret: "etat-secret-0123456789-0123456789",
  client: {
    clientId: "id",
    clientSecret: SECRET,
    redirectUri: "https://app/api/integrations/jira/callback",
  },
};
const ctx: OrgContext = {
  headers: new Headers(),
  orgId: A,
  userId: owner,
  role: "owner",
  db: forOrg(A),
};
let integrationId = "";
let systemId = "";
const scheduled: string[] = [];

async function drainOrg() {
  for (let round = 0; round < 6; round++) {
    const queued = await prisma.job.findMany({
      where: { orgId: A, status: "QUEUED", runAt: { lte: new Date() } },
    });
    if (queued.length === 0) return;
    for (const job of queued) await runJobNow(job.id, jobRegistry);
  }
}

const snapshotsOf = (resourceId: string) =>
  forOrg(A).evidenceItem.findMany({
    where: { resourceId, kind: "jira.issue.snapshot" },
    orderBy: { capturedAt: "asc" },
  });

beforeAll(async () => {
  process.env.PROOFLAYER_MASTER_KEY ??= generateKey().toString("base64");
  jiraJobDependencies.current = () => deps;
  await prisma.organization.create({ data: { id: A, name: A, slug: A } });
  ({ integrationId } = await completeJiraAuthorization(
    ctx,
    { code: "code", state: signState({ orgId: A, userId: owner }, deps.stateSecret, jira.clock) },
    deps,
  ));
  systemId = (
    await forOrg(A).aiSystem.create({
      data: {
        orgId: A,
        name: "Score",
        slug: `score-${run}`,
        intendedPurpose: "Test",
        ownerUserId: owner,
        models: [],
      },
    })
  ).id;
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "Job" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "WebhookDelivery" WHERE "deliveryId" LIKE $1`, [
      `jira-${run}-%`,
    ]);
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [A]);
    await client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "EvidenceItem" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "OrgEncryptionKey" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "Organization" WHERE id = $1`, [A]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("correspondances", () => {
  it("prévisualisation : nombre de tickets ; requête refusée par Jira → invalidJql", async () => {
    expect(await previewJiraQuery(ctx, { integrationId, jql: "labels = ai-risk" }, deps)).toEqual({
      count: 1,
    });
    await expect(
      previewJiraQuery(ctx, { integrationId, jql: "project in (" }, deps),
    ).rejects.toThrow("integration.jira.invalidJql");
  });

  it("enregistrement : ressource reliée au système, journalisée, rattrapage programmé", async () => {
    const result = await saveJiraMapping(
      ctx,
      { systemId, purpose: "risks", jql: "labels = ai-risk", acceptanceField: "customfield_10050" },
      async (org, id) => scheduled.push(`${org}:${id}`),
      deps,
    );
    expect(result.count).toBe(1);
    expect(scheduled).toEqual([`${A}:${integrationId}`]);
    const link = await forOrg(A).systemResourceLink.findFirst({
      where: { systemId, resourceId: result.resourceId },
    });
    expect(link).not.toBeNull();
    const entry = await forOrg(A).auditLog.findFirstOrThrow({
      where: { action: "integration.mapping" },
    });
    expect(entry.metadata).toMatchObject({ purpose: "risks", jql: "labels = ai-risk", tickets: 1 });
    // Réenregistrer met à jour la même correspondance.
    const again = await saveJiraMapping(
      ctx,
      { systemId, purpose: "risks", jql: "labels = ai-risk" },
      async () => undefined,
      deps,
    );
    expect(again.resourceId).toBe(result.resourceId);
    await saveJiraMapping(
      ctx,
      { systemId, purpose: "incidents", jql: 'issuetype = "AI Incident"' },
      async () => undefined,
      deps,
    );
  });

  it("champ d'acceptation invalide ou requête vide refusés", async () => {
    await expect(
      saveJiraMapping(
        ctx,
        { systemId, purpose: "risks", jql: "labels = x", acceptanceField: "summary" },
        async () => undefined,
        deps,
      ),
    ).rejects.toThrow("integration.jira.invalidField");
    await expect(
      saveJiraMapping(ctx, { systemId, purpose: "risks", jql: "   " }, async () => undefined, deps),
    ).rejects.toThrow("integration.jira.invalidJql");
  });
});

describe("synchronisation", () => {
  it("rattrapage complet : chaque ticket de chaque correspondance devient preuve, avec ses transitions", async () => {
    await enqueue(jiraReconcileJob, { integrationId, mode: "full" as const }, { orgId: A });
    await drainOrg();
    const mappings = await forOrg(A).integrationResource.findMany({
      where: { kind: "jira_query" },
    });
    const risks = mappings.find((m) => (m.config as { purpose: string }).purpose === "risks")!;
    const incidents = mappings.find(
      (m) => (m.config as { purpose: string }).purpose === "incidents",
    )!;
    const riskSnapshots = await snapshotsOf(risks.id);
    expect(riskSnapshots.map((e) => (e.payload as { key: string }).key)).toEqual(["AIR-12"]);
    expect(riskSnapshots[0]!.payload).toMatchObject({
      inMapping: true,
      acceptedByAccountId: "5f0000000000000000000003",
      capturedAt: jira.clock.toISOString(),
    });
    expect(riskSnapshots[0]!.capturedVia).toBe("BACKFILL");
    const incidentEvidence = await forOrg(A).evidenceItem.findMany({
      where: { resourceId: incidents.id },
    });
    expect(incidentEvidence.map((e) => e.kind).sort()).toEqual([
      "jira.issue.snapshot",
      "jira.issue.transitioned",
      "jira.issue.transitioned",
      "jira.issue.transitioned",
    ]);
    const integration = await forOrg(A).integration.findUniqueOrThrow({
      where: { id: integrationId },
    });
    expect(integration.lastSyncAt).not.toBeNull();
  });

  it("relire le même ticket sans changement n'ajoute rien ; un ticket qui quitte la correspondance est marqué sorti", async () => {
    const sync = (key: string) =>
      withOrgTransaction(A, (tx) =>
        syncIssue(
          tx,
          { orgId: A, integrationId, issueKey: key, capturedVia: "WEBHOOK" },
          deps,
          scheduleEvaluation,
        ),
      );
    expect(await sync("AIR-12")).toEqual({ created: 0 });
    const risk = jira.issues.get("AIR-12")!;
    jira.issues.set("AIR-12", {
      ...risk,
      fields: { ...(risk.fields as object), labels: ["fairness"] },
    });
    expect(await sync("AIR-12")).toEqual({ created: 1 });
    const mapping = await forOrg(A).integrationResource.findFirstOrThrow({
      where: { kind: "jira_query", externalId: `${systemId}:risks` },
    });
    const last = (await snapshotsOf(mapping.id)).at(-1)!;
    expect(last.payload).toMatchObject({ key: "AIR-12", inMapping: false });
    // Ticket supprimé dans Jira : déjà sorti, rien de plus.
    jira.issues.delete("AIR-12");
    expect(await sync("AIR-12")).toEqual({ created: 0 });
    jira.issues.set("AIR-12", risk);
  });
});

describe("webhook du site", () => {
  const ensure = () =>
    withOrgTransaction(A, (tx) =>
      ensureWebhook(
        tx,
        { orgId: A, integrationId, url: `https://app/api/webhooks/jira/${CLOUD}` },
        deps,
      ),
    );

  it("un seul webhook, filtré par project IN (…), prolongé avant 30 jours, réenregistré si les projets changent", async () => {
    expect(await ensure()).toMatchObject({ action: "registered", projects: ["AIR"] });
    expect(jira.webhooks.at(-1)).toMatchObject({ jqlFilter: "project IN (AIR)" });
    expect(await ensure()).toEqual({ action: "none" });
    jira.clock = new Date(jira.clock.getTime() + 25 * 86_400_000);
    expect(await ensure()).toEqual({ action: "refreshed" });
    expect(jira.refreshed).toEqual([jira.webhooks.at(-1)!.id]);
    // Un nouveau projet utile : l'ancien webhook est supprimé, un nouveau couvre les deux projets.
    await saveJiraMapping(
      ctx,
      { systemId, purpose: "monitoring_reviews", jql: "labels = ai-monitoring-review" },
      async () => undefined,
      deps,
    );
    await enqueue(jiraReconcileJob, { integrationId, mode: "full" as const }, { orgId: A });
    await drainOrg();
    const previous = jira.webhooks.at(-1)!.id;
    expect(await ensure()).toMatchObject({ action: "registered", projects: ["AIR", "OPS"] });
    expect(jira.deleted).toEqual([previous]);
    expect(await forOrg(A).integrationResource.count({ where: { kind: "jira_webhook" } })).toBe(1);
  });

  it("réception : JWT vérifié, livraison idempotente, ticket relu jusqu'à la preuve", async () => {
    process.env.JIRA_CLIENT_SECRET = SECRET;
    const { POST } = await import("@/app/api/webhooks/jira/[cloudId]/route");
    const jwt = (key: string) => {
      const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const p = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 })).toString(
        "base64url",
      );
      return `${h}.${p}.${createHmac("sha256", key).update(`${h}.${p}`).digest("base64url")}`;
    };
    const incident = jira.issues.get("AIR-40")!;
    jira.issues.set("AIR-40", {
      ...incident,
      fields: {
        ...(incident.fields as object),
        updated: "2026-11-20T09:00:00.000Z",
        status: { name: "Rouvert", statusCategory: { key: "new" } },
      },
    });
    const deliveryId = `jira-${run}-1`;
    const request = (auth: string) =>
      new Request(`http://localhost/api/webhooks/jira/${CLOUD}`, {
        method: "POST",
        headers: { authorization: auth, "x-atlassian-webhook-identifier": deliveryId },
        body: JSON.stringify({ webhookEvent: "jira:issue_updated", issue: { key: "AIR-40" } }),
      });
    const params = { params: Promise.resolve({ cloudId: CLOUD }) };
    expect((await POST(request(`JWT ${jwt("autre")}`), params)).status).toBe(401);
    expect((await POST(request(`JWT ${jwt(SECRET)}`), params)).status).toBe(202);
    expect((await POST(request(`JWT ${jwt(SECRET)}`), params)).status).toBe(202);
    expect(await prisma.webhookDelivery.count({ where: { deliveryId } })).toBe(1);
    for (let i = 0; i < 50; i++) {
      const status = (await prisma.webhookDelivery.findFirst({ where: { deliveryId } }))?.status;
      if (status === "PROCESSED") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await drainOrg();
    const reopened = await forOrg(A).evidenceItem.findFirst({
      where: { kind: "jira.issue.snapshot", payload: { path: ["status"], equals: "Rouvert" } },
    });
    expect(reopened?.capturedVia).toBe("WEBHOOK");
  });
});
