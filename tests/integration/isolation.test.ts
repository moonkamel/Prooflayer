// PL-105 — Test d'étanchéité entre organisations (§4.3.3, §4.7, prompt-type de PL-105).
// Exécuté sous le rôle applicatif prooflayer_app (DATABASE_URL), jamais sous le rôle de migration :
// c'est le contournement de RLS par le rôle de connexion qui est le risque principal du sprint 1 (§9.3).
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma } from "@/server/db";

/** Tables système sans RLS (prompt-type de PL-105) qui portent pourtant une colonne orgId. */
const SYSTEM_TABLES_WITH_ORG_ID = ["Job"];

const run = randomUUID().slice(0, 8);
const A = `org_iso_a_${run}`;
const B = `org_iso_b_${run}`;
const bytes = () => new Uint8Array(32);
const id = (org: string, model: string, tag = "") => `${model}_${org}${tag}`;
const DEFINITION_ID = `cdef_iso_${run}`;

type Row = Record<string, unknown>;

/**
 * Une ligne valide par table métier, pour une organisation donnée. L'ordre respecte les clés étrangères.
 * Toute table portant orgId doit figurer ici : le test « couverture » échoue sinon.
 */
const fixtures: [model: string, table: string, build: (org: string, tag?: string) => Row][] = [
  [
    "aiSystem",
    "AiSystem",
    (o, t = "") => ({
      id: id(o, "sys", t),
      orgId: o,
      name: "S",
      slug: `s${t}`,
      intendedPurpose: "P",
      ownerUserId: "u",
      models: [],
    }),
  ],
  [
    "classification",
    "Classification",
    (o, t = "") => ({
      id: id(o, "cls", t),
      orgId: o,
      systemId: id(o, "sys"),
      rulesetVersion: "2026.11.0",
      answers: {},
      tier: "MINIMAL",
      role: "PROVIDER",
      reasoning: [],
    }),
  ],
  [
    "exemptionDossier",
    "ExemptionDossier",
    (o, t = "") => ({
      id: id(o, "exd", t),
      orgId: o,
      systemId: id(o, "sys"),
      classificationId: id(o, "cls"),
      conditionJustification: "C",
      profilingJustification: "P",
      providerName: "N",
      providerAddress: "A",
      providerContact: "C",
      tradeName: "T",
      memberStates: [],
    }),
  ],
  [
    "designChange",
    "DesignChange",
    (o, t = "") => ({
      id: id(o, "dch", t),
      orgId: o,
      systemId: id(o, "sys"),
      occurredAt: new Date(),
      summary: "S",
    }),
  ],
  [
    "controlInstance",
    "ControlInstance",
    (o, t = "") => ({
      id: id(o, "cin", t),
      orgId: o,
      systemId: id(o, "sys", t),
      definitionId: DEFINITION_ID,
    }),
  ],
  [
    "controlEvaluation",
    "ControlEvaluation",
    (o, t = "") => ({
      id: id(o, "cev", t),
      orgId: o,
      controlInstanceId: id(o, "cin"),
      status: "PASS",
      reasons: [],
      evaluatorVersion: "1",
    }),
  ],
  [
    "integration",
    "Integration",
    (o, t = "") => ({
      id: id(o, "int", t),
      orgId: o,
      provider: "GITHUB",
      externalAccountId: `ext_${o}${t}`,
      externalAccountName: "E",
      createdByUserId: "u",
    }),
  ],
  [
    "integrationResource",
    "IntegrationResource",
    (o, t = "") => ({
      id: id(o, "res", t),
      orgId: o,
      integrationId: id(o, "int"),
      kind: "github_repo",
      externalId: `r${t}`,
      name: "R",
      config: {},
    }),
  ],
  [
    "systemResourceLink",
    "SystemResourceLink",
    (o, t = "") => ({ systemId: id(o, "sys", t), resourceId: id(o, "res"), orgId: o }),
  ],
  [
    "evidenceItem",
    "EvidenceItem",
    (o, t = "") => ({
      id: id(o, "evi", t),
      orgId: o,
      kind: "manual.upload",
      source: "MANUAL",
      capturedVia: "UPLOAD",
      sourceRef: "x",
      dedupeKey: `d${t}`,
      occurredAt: new Date(),
      summary: "S",
      contentSha256: bytes(),
      leafHash: bytes(),
    }),
  ],
  [
    "evidenceLink",
    "EvidenceLink",
    (o, t = "") => ({ evidenceId: id(o, "evi", t), controlInstanceId: id(o, "cin"), orgId: o }),
  ],
  [
    "sealBatch",
    "SealBatch",
    (o, t = "") => ({
      id: id(o, "seb", t),
      orgId: o,
      seq: t ? 2 : 1,
      leafCount: 0,
      merkleRoot: bytes(),
      prevBatchHash: bytes(),
      batchHash: bytes(),
    }),
  ],
  [
    "auditPack",
    "AuditPack",
    (o, t = "") => ({
      id: id(o, "pck", t),
      orgId: o,
      systemId: id(o, "sys"),
      requestedByUserId: "u",
      periodStart: new Date(),
      periodEnd: new Date(),
    }),
  ],
  [
    "auditLog",
    "AuditLog",
    (o, t = "") => ({
      id: id(o, "log", t),
      orgId: o,
      actorType: "system",
      action: "test",
      targetType: "t",
      targetId: "t",
      metadata: {},
    }),
  ],
  [
    "notification",
    "Notification",
    (o, t = "") => ({ id: id(o, "ntf", t), orgId: o, userId: "u", type: "test", payload: {} }),
  ],
  ["subscription", "Subscription", (o, t = "") => ({ id: id(o, "sub", t), orgId: `${o}${t}` })],
  [
    "apiKey",
    "ApiKey",
    (o, t = "") => ({
      id: id(o, "key", t),
      orgId: o,
      name: "K",
      prefix: "pl_live_x",
      hashedKey: `h_${o}${t}`,
      createdByUserId: "u",
    }),
  ],
  [
    "orgEncryptionKey",
    "OrgEncryptionKey",
    (o, t = "") => ({ orgId: `${o}${t}`, wrappedDek: bytes(), kekId: "k" }),
  ],
];

interface Delegate {
  create(args: { data: Row }): Promise<unknown>;
  findMany(args?: { where?: Row }): Promise<Row[]>;
}
const delegate = (client: unknown, model: string) => (client as Record<string, Delegate>)[model]!;

/** Rôle de migration, pour la préparation qui sort du périmètre d'une organisation et pour le nettoyage. */
async function asMigrationRole(sql: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  for (const org of [A, B]) {
    await prisma.organization.create({ data: { id: org, name: org, slug: org } });
  }
  // Référentiel commun, écrit sous le rôle de migration (PL-206 : le rôle applicatif ne l'écrit pas).
  await asMigrationRole(
    `INSERT INTO "ControlDefinition"
       (id, key, "libraryVersion", "articleRef", pack, title, statement, "appliesToRoles", "appliesToTiers",
        automation, "evidenceKinds", "evaluatorKey", params)
     VALUES ($1, $2, 'test', 'Art. 0', 'A', '{}', '{}', ARRAY[]::"AiActRole"[], ARRAY[]::"RiskTier"[],
        'MANUAL', ARRAY[]::text[], 'none', '{}')`,
    [DEFINITION_ID, `AIA-ISO-${run}`],
  );
  // Écritures légitimes : chaque organisation écrit ses propres lignes, sous le rôle applicatif, via forOrg.
  for (const org of [A, B]) {
    const db = forOrg(org);
    for (const [model, , build] of fixtures) await delegate(db, model).create({ data: build(org) });
  }
});

/** AuditLog est en ajout seul (PL-106) : seule la purge d'une organisation, app.purge_org positionné, le vide. */
async function purgeAuditLog(orgId: string) {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.purge_org', $1, true)`, [orgId]);
    await client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [orgId]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
}

afterAll(async () => {
  for (const org of [A, B]) await purgeAuditLog(org);
  const tables = fixtures
    .map(([, table]) => table)
    .filter((table) => table !== "AuditLog")
    .reverse();
  for (const table of tables) {
    await asMigrationRole(`DELETE FROM "${table}" WHERE "orgId" LIKE $1`, [`org_iso_%_${run}%`]);
  }
  await asMigrationRole(`DELETE FROM "ControlDefinition" WHERE id = $1`, [DEFINITION_ID]);
  await asMigrationRole(`DELETE FROM "Organization" WHERE id IN ($1, $2)`, [A, B]);
  await prisma.$disconnect();
});

describe("catalogue : toute table portant orgId est isolée", () => {
  it("le test se connecte sous le rôle applicatif, sans BYPASSRLS", async () => {
    const [row] = await prisma.$queryRaw<{ name: string; bypass: boolean; superuser: boolean }[]>`
      SELECT current_user AS name, rolbypassrls AS bypass, rolsuper AS superuser
      FROM pg_roles WHERE rolname = current_user`;
    expect(row).toEqual({ name: "prooflayer_app", bypass: false, superuser: false });
  });

  it("RLS activé et forcé, avec une politique, sur chaque table portant orgId (hors tables système)", async () => {
    const rows = await asMigrationRole(`
      SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)::int AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN information_schema.columns col
        ON col.table_schema = n.nspname AND col.table_name = c.relname AND col.column_name = 'orgId'
      WHERE n.nspname = 'public' AND c.relkind = 'r'`);
    const unprotected = rows
      .filter((r) => !SYSTEM_TABLES_WITH_ORG_ID.includes(r.table))
      .filter((r) => !r.enabled || !r.forced || r.policies === 0)
      .map((r) => r.table);
    expect(unprotected).toEqual([]);
  });

  it("chaque table isolée est couverte par une donnée de test", async () => {
    const rows = await asMigrationRole(`
      SELECT table_name AS table FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'orgId'`);
    const expected = rows.map((r) => r.table).filter((t) => !SYSTEM_TABLES_WITH_ORG_ID.includes(t));
    expect(fixtures.map(([, table]) => table).sort()).toEqual(expected.sort());
  });
});

describe.each(fixtures)("%s", (model, table, build) => {
  it("forOrg(A) ne lit que les lignes de A", async () => {
    const rows = await delegate(forOrg(A), model).findMany();
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.orgId))).toEqual(new Set([A]));
    expect(await delegate(forOrg(A), model).findMany({ where: { orgId: B } })).toEqual([]);
  });

  it("forOrg(A) ne peut pas écrire une ligne de B", async () => {
    const error = await delegate(forOrg(A), model)
      .create({ data: build(B, "_x") })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error, `écriture croisée acceptée dans ${table}`).not.toBeNull();
    expect(String((error as Error).message ?? error)).toMatch(/row-level security/iu);
  });

  it("sans forOrg, le rôle applicatif ne voit aucune ligne", async () => {
    expect(await delegate(prisma, model).findMany({ where: { orgId: { in: [A, B] } } })).toEqual(
      [],
    );
  });
});
