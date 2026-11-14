// PL-406 — Dashboard sur base réelle : compteurs, source dominante et nombre de preuves par contrôle, état « Connectez
// … pour évaluer », courbe sur 90 jours, vue organisation ; exigence du ticket : vue système chargée en moins de 1,5 s
// avec 5 000 preuves (la bibliothèque compte 37 contrôles par système, pas 60 : voir la PR).
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma } from "@/server/db";
import { LIBRARY_VERSION } from "@/server/rules/library";
import { orgSummary, systemSummary } from "@/server/services/dashboard";
import type { OrgContext } from "@/server/services/organization";

const run = randomUUID().slice(0, 8);
const A = `org_dash_${run}`;
const owner = `usr_dash_${run}`;
let systemId = "";
let emptySystemId = "";
const ctx: OrgContext = {
  headers: new Headers(),
  orgId: A,
  userId: owner,
  role: "owner",
  db: forOrg(A),
};
const direct = () => new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });

beforeAll(async () => {
  await prisma.organization.create({ data: { id: A, name: A, slug: A } });
  await prisma.user.create({
    data: { id: owner, email: `${owner}@dash.test`, name: "Clara Martin" },
  });
  const db = forOrg(A);
  systemId = (
    await db.aiSystem.create({
      data: {
        monitored: true,
        orgId: A,
        name: "Score",
        slug: `score-${run}`,
        intendedPurpose: "T",
        ownerUserId: owner,
        models: [],
      },
    })
  ).id;
  emptySystemId = (
    await db.aiSystem.create({
      data: {
        monitored: true,
        orgId: A,
        name: "Assistant",
        slug: `assistant-${run}`,
        intendedPurpose: "T",
        ownerUserId: owner,
        models: [],
      },
    })
  ).id;
  const definitions = await prisma.controlDefinition.findMany({
    where: { libraryVersion: LIBRARY_VERSION, deprecatedAt: null },
    orderBy: { key: "asc" },
  });
  const created = new Date(Date.now() - 60 * 86_400_000);
  await db.controlInstance.createMany({
    data: definitions.map((d) => ({
      orgId: A,
      systemId,
      definitionId: d.id,
      createdAt: created,
      status:
        d.key === "AIA-15-02"
          ? "PASS"
          : d.key === "AIA-15-05"
            ? "FAIL"
            : d.key === "AIA-09-02"
              ? "STALE"
              : d.key === "AIA-04-01"
                ? "NOT_APPLICABLE"
                : "MISSING",
      notApplicable: d.key === "AIA-04-01",
      ownerUserId: d.key === "AIA-15-02" ? owner : null,
    })),
  });
  const instances = await db.controlInstance.findMany({
    where: { systemId },
    include: { definition: true },
  });
  const id = (key: string) => instances.find((i) => i.definition.key === key)!.id;

  // 5 000 preuves liées aux contrôles (dont 3 Jira sur AIA-15-02), 30 évaluations par contrôle sur 90 jours.
  const client = direct();
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "EvidenceItem" (id, "orgId", kind, source, "capturedVia", "sourceRef", "dedupeKey", "occurredAt",
         "capturedAt", summary, "contentSha256", "leafHash")
       SELECT 'ev_dash_' || $2 || '_' || g, $1, 'github.pull_request.merged',
         (CASE WHEN g <= 3 THEN 'JIRA' ELSE 'GITHUB' END)::"EvidenceSource", 'WEBHOOK', 'ref' || g, 'dash:' || g,
         now() - make_interval(mins => g), now() - make_interval(mins => g), 'perf',
         decode(md5(g::text) || md5(g::text), 'hex'), decode(md5(g::text) || md5(g::text), 'hex')
       FROM generate_series(1, 5000) g`,
      [A, run],
    );
    const ids = instances.map((i) => i.id);
    await client.query(
      `INSERT INTO "EvidenceLink" ("evidenceId", "controlInstanceId", "orgId", "linkedBy")
       SELECT 'ev_dash_' || $2 || '_' || g,
         CASE WHEN g <= 5 THEN $4 ELSE ($3::text[])[1 + g % array_length($3::text[], 1)] END, $1, 'rule'
       FROM generate_series(1, 5000) g`,
      [A, run, ids, id("AIA-15-02")],
    );
    await client.query(
      `INSERT INTO "ControlEvaluation" (id, "orgId", "controlInstanceId", status, reasons, "evidenceIds",
         "evaluatorVersion", "evaluatedAt")
       SELECT 'cev_' || $2 || '_' || i || '_' || g, $1, i, 'MISSING', '[]', '{}', 'test@1', now() - make_interval(days => 3 * g)
       FROM unnest($3::text[]) i, generate_series(1, 30) g`,
      [A, run, ids],
    );
    // AIA-15-02 passe à PASS il y a 2 jours, après la dernière évaluation MISSING : la courbe monte d'un cran.
    await client.query(
      `INSERT INTO "ControlEvaluation" (id, "orgId", "controlInstanceId", status, reasons, "evidenceIds",
         "evaluatorVersion", "evaluatedAt")
       VALUES ('cev_' || $2 || '_pass', $1, $3, 'PASS', '[]', '{}', 'test@1', now() - interval '2 days')`,
      [A, run, id("AIA-15-02")],
    );
    // Statistiques à jour après l'insertion massive, comme l'autovacuum le fait en production.
    await client.query(
      `ANALYZE "EvidenceItem", "EvidenceLink", "ControlEvaluation", "ControlInstance"`,
    );
  } finally {
    await client.end();
  }
});

afterAll(async () => {
  const client = direct();
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [A]);
    await client.query(`DELETE FROM "EvidenceItem" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "Organization" WHERE id = $1`, [A]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [owner]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("dashboard système", () => {
  it("chargé en moins de 1,5 s avec 37 contrôles et 5 000 preuves", async () => {
    await systemSummary(ctx, { systemId }); // préchauffage des connexions
    const started = performance.now();
    const summary = await systemSummary(ctx, { systemId });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(summary.controls).toHaveLength(37);
  });

  it("compteurs : couverture et contrôles en échec, périmés, sans preuve ; non applicables à part", async () => {
    const { counts } = await systemSummary(ctx, { systemId });
    expect(counts).toEqual({
      applicable: 36,
      pass: 1,
      fail: 1,
      partial: 0,
      stale: 1,
      missing: 33,
      notApplicable: 1,
    });
  });

  it("par contrôle : preuves liées, source dominante, responsable, groupé par article", async () => {
    const { controls, lastEvidenceAt } = await systemSummary(ctx, { systemId });
    const peer = controls.find((c) => c.key === "AIA-15-02")!;
    expect(peer).toMatchObject({
      article: "Art. 15",
      owner: { id: owner, name: "Clara Martin" },
      status: "PASS",
    });
    expect(peer.sources.JIRA).toBe(3);
    expect(peer.evidenceCount).toBeGreaterThan(100);
    expect(peer.dominantSource).toBe("GITHUB");
    expect(lastEvidenceAt).not.toBeNull();
    // Trié par article puis par clé.
    const articles = controls.map((c) => c.article);
    expect(articles.indexOf("Art. 9")).toBeLessThan(articles.indexOf("Art. 15"));
  });

  it("sans connecteur : les contrôles automatisés sans preuve invitent à connecter GitHub ou Jira", async () => {
    const { controls } = await systemSummary(ctx, { systemId });
    expect(controls.find((c) => c.key === "AIA-15-01")!.needsConnector).toBe("GITHUB");
    expect(controls.find((c) => c.key === "AIA-09-01")!.needsConnector).toBe("JIRA");
    expect(controls.find((c) => c.key === "AIA-15-02")!.needsConnector).toBeNull();
    expect(controls.find((c) => c.key === "AIA-47-01")!.needsConnector).toBeNull();
  });

  it("courbe sur 90 jours : 0 avant le passage d'AIA-15-02, 1 depuis", async () => {
    const { timeline } = await systemSummary(ctx, { systemId });
    expect(timeline).toHaveLength(90);
    expect(timeline[0]!.applicable).toBe(0);
    expect(timeline.at(-1)).toMatchObject({ pass: 1, applicable: 36 });
    expect(timeline.at(-20)).toMatchObject({ pass: 0, applicable: 36 });
  });

  it("système d'une autre organisation : introuvable", async () => {
    const other: OrgContext = { ...ctx, orgId: `org_autre_${run}`, db: forOrg(`org_autre_${run}`) };
    await expect(systemSummary(other, { systemId })).rejects.toThrow("system.notFound");
  });
});

describe("dashboard organisation", () => {
  it("un système par ligne et les totaux ; un système sans contrôle compte zéro", async () => {
    const summary = await orgSummary(ctx);
    expect(summary.systems.map((s) => s.name)).toEqual(["Assistant", "Score"]);
    expect(summary.systems.find((s) => s.id === emptySystemId)!.counts.applicable).toBe(0);
    expect(summary.total).toMatchObject({ applicable: 36, pass: 1, fail: 1, stale: 1 });
    expect(summary.systems.find((s) => s.id === systemId)!.lastEvaluatedAt).toBeNull();
  });
});
