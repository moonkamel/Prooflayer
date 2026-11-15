// PL-608 — Entonnoir sur base réelle : étapes tirées des données (inscription du premier owner, classification
// signée, connecteur, première preuve hors system.*, premier pack prêt), inscrites une seule fois ; part des contrôles
// évalués automatiquement ; transmission PostHog pseudonymisée, une fois, sans corps d'erreur.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma, withOrgTransaction } from "@/server/db";
import { LIBRARY_VERSION } from "@/server/rules/library";
import { syncFunnelEvents } from "@/server/services/funnel";
import { analyticsDependencies } from "@/server/system/jobs/analytics";
import { jobRegistry } from "@/server/system/jobs/handlers";
import { runJobNow } from "@/server/system/jobs/queue";
import { syncAllFunnels } from "@/server/system/funnel";

const run = randomUUID().slice(0, 8);
const A = `org_fnl_${run}`;
const owner = `usr_fnl_${run}`;
const signup = new Date("2026-11-15T09:00:00Z");
const posted: { url: string; body: Record<string, unknown> }[] = [];
let status = 200;

beforeAll(async () => {
  await prisma.user.create({
    data: { id: owner, email: `${owner}@fnl.test`, name: "Clara", createdAt: signup },
  });
  await prisma.organization.create({ data: { id: A, name: "Talvio", slug: A } });
  await prisma.member.create({
    data: { id: `mem_${owner}`, organizationId: A, userId: owner, role: "owner" },
  });
  const system = await forOrg(A).aiSystem.create({
    data: {
      orgId: A,
      name: "Score",
      slug: `score-${run}`,
      intendedPurpose: "Tri",
      ownerUserId: owner,
      models: [],
      monitored: true,
    },
  });
  await forOrg(A).classification.create({
    data: {
      orgId: A,
      systemId: system.id,
      rulesetVersion: "test",
      status: "SIGNED",
      tier: "MINIMAL",
      role: "PROVIDER",
      answers: {},
      reasoning: [],
      signedAt: new Date("2026-11-15T09:05:00Z"),
    },
  });
  await forOrg(A).integration.create({
    data: {
      orgId: A,
      provider: "JIRA",
      externalAccountId: `cloud-${run}`,
      externalAccountName: "talvio",
      createdByUserId: owner,
      createdAt: new Date("2026-11-15T09:07:00Z"),
    },
  });
  const evidence = (kind: string, capturedAt: string, n: number) => ({
    orgId: A,
    kind,
    source: "JIRA" as const,
    capturedVia: "WEBHOOK" as const,
    sourceRef: `ref-${n}`,
    dedupeKey: `fnl-${run}-${n}`,
    occurredAt: new Date(capturedAt),
    capturedAt: new Date(capturedAt),
    summary: "s",
    contentSha256: new Uint8Array(32),
    salt: new Uint8Array(32),
    leafHash: new Uint8Array(32),
  });
  await forOrg(A).evidenceItem.createMany({
    data: [
      evidence("system.registry.snapshot", "2026-11-15T09:01:00Z", 1),
      evidence("jira.issue.snapshot", "2026-11-15T09:11:00Z", 2),
    ],
  });
  await forOrg(A).auditPack.create({
    data: {
      orgId: A,
      systemId: system.id,
      requestedByUserId: owner,
      periodStart: new Date("2026-11-01T00:00:00Z"),
      periodEnd: new Date("2026-11-15T00:00:00Z"),
      status: "READY",
      createdAt: new Date("2026-11-15T09:40:00Z"),
    },
  });
  const definitions = await prisma.controlDefinition.findMany({
    where: { libraryVersion: LIBRARY_VERSION },
    select: { id: true, evaluatorKey: true },
  });
  const jira = definitions.find((d) => d.evaluatorKey.startsWith("jira."))!;
  const manual = definitions.find((d) => d.evaluatorKey.startsWith("manual."))!;
  await forOrg(A).controlInstance.createMany({
    data: [
      { orgId: A, systemId: system.id, definitionId: jira.id, status: "PASS" },
      { orgId: A, systemId: system.id, definitionId: manual.id, status: "PASS" },
    ],
  });
  analyticsDependencies.config = () => ({
    apiKey: "phc_test",
    host: "https://eu.i.posthog.com",
    secret: "secret",
  });
  analyticsDependencies.fetch = (async (url: string, init: RequestInit) => {
    posted.push({ url, body: JSON.parse(String(init.body)) });
    return new Response("détail à ne jamais journaliser", { status });
  }) as typeof fetch;
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "Job" WHERE "orgId" = $1`, [A]);
    await client.query("SELECT purge_organization($1)", [A]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [owner]);
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("étapes de l'entonnoir", () => {
  it("dates exactes tirées des données ; preuves system.* ignorées ; inscrites une seule fois", async () => {
    const first = await withOrgTransaction(A, (tx) => syncFunnelEvents(tx, A));
    expect(first.created).toHaveLength(5);
    expect(first.funnel.firstEvidenceMinutes).toBe(11);
    expect(first.funnel.automated).toEqual({ evaluated: 1, applicable: 2, share: 0.5 });
    const events = await forOrg(A).funnelEvent.findMany({ orderBy: { occurredAt: "asc" } });
    expect(events.map((e) => [e.name, e.occurredAt.toISOString()])).toEqual([
      ["signup", "2026-11-15T09:00:00.000Z"],
      ["classification_signed", "2026-11-15T09:05:00.000Z"],
      ["connector_linked", "2026-11-15T09:07:00.000Z"],
      ["first_evidence", "2026-11-15T09:11:00.000Z"],
      ["first_pack", "2026-11-15T09:40:00.000Z"],
    ]);
    expect((await withOrgTransaction(A, (tx) => syncFunnelEvents(tx, A))).created).toEqual([]);
  });

  it("passage quotidien : synthèse et envois programmés pour les étapes non transmises", async () => {
    const { rows, summary } = await syncAllFunnels();
    expect(rows.find((r) => r.orgId === A)?.funnel.steps.first_pack).not.toBeNull();
    expect(summary.organizations).toBeGreaterThanOrEqual(1);
    expect(await prisma.job.count({ where: { orgId: A, type: "analytics.capture" } })).toBe(5);
    // Parcourt toutes les organisations de la base de test : délai élargi (en production, job maintenance.daily).
  }, 60_000);
});

describe("PostHog", () => {
  it("organisation pseudonymisée, une fois par étape ; une erreur ne journalise pas la réponse", async () => {
    const jobs = await prisma.job.findMany({ where: { orgId: A, type: "analytics.capture" } });
    status = 503;
    const failed = await runJobNow(jobs[0]!.id, jobRegistry);
    const retried = await prisma.job.findUniqueOrThrow({ where: { id: jobs[0]!.id } });
    expect(retried.lastError).toBe("Error: PostHog : HTTP 503");
    expect(failed).not.toBeNull();
    status = 200;
    await prisma.job.updateMany({ where: { orgId: A }, data: { runAt: new Date(0) } });
    for (const job of jobs) await runJobNow(job.id, jobRegistry);
    expect(await forOrg(A).funnelEvent.count({ where: { sentAt: null } })).toBe(0);
    const ok = posted.slice(1);
    expect(ok).toHaveLength(5);
    for (const p of ok) {
      expect(p.url).toBe("https://eu.i.posthog.com/i/v0/e/");
      expect(JSON.stringify(p.body)).not.toContain(A);
      expect(JSON.stringify(p.body)).not.toContain("Talvio");
    }
  });
});
