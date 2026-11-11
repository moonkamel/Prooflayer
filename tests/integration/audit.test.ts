// PL-106 — Journal d'audit : écriture par organisation, lecture filtrée, ajout seul.
// Sous le rôle applicatif (DATABASE_URL) ; les tentatives du rôle propriétaire passent par DIRECT_DATABASE_URL.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma } from "@/server/db";
import { audit, exportAuditCsv, listAudit, parseAuditFilters } from "@/server/services/audit";

const run = randomUUID().slice(0, 8);
const A = `org_audit_a_${run}`;
const B = `org_audit_b_${run}`;

async function asMigrationRole(statements: (client: pg.Client) => Promise<void>) {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await statements(client);
  } finally {
    await client.end();
  }
}

async function errorOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "",
    (e: unknown) => String((e as Error).message ?? e),
  );
}

beforeAll(async () => {
  for (const org of [A, B]) {
    await prisma.organization.create({ data: { id: org, name: org, slug: org } });
  }
  const actor = { type: "user" as const, id: "usr_test" };
  await audit(
    { orgId: A, actor, ipAddress: "203.0.113.1" },
    "member.invite",
    { type: "invitation", id: "x@a.test" },
    { role: "auditor" },
  );
  await audit(
    { orgId: A, actor },
    "member.setRole",
    { type: "member", id: "mem_1" },
    { from: "auditor", to: "admin" },
  );
  await audit(
    { orgId: B, actor },
    "organization.update",
    { type: "organization", id: B },
    { name: "=cmd()" },
  );
});

afterAll(async () => {
  await asMigrationRole(async (client) => {
    for (const org of [A, B]) {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.purge_org', $1, true)`, [org]);
      await client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [org]);
      await client.query("COMMIT");
    }
    await client.query(`DELETE FROM "Organization" WHERE id IN ($1, $2)`, [A, B]);
  });
  await prisma.$disconnect();
});

describe("écriture et lecture", () => {
  it("audit() inscrit acteur, action, cible, métadonnées et adresse", async () => {
    const { entries } = await listAudit(forOrg(A), {}, { limit: 10 });
    expect(entries).toHaveLength(2);
    const invite = entries.find((e) => e.action === "member.invite");
    expect(invite).toMatchObject({
      actorType: "user",
      actorId: "usr_test",
      targetType: "invitation",
      targetId: "x@a.test",
      metadata: { role: "auditor" },
      ipAddress: "203.0.113.1",
    });
  });

  it("une organisation ne lit que son journal", async () => {
    const { entries } = await listAudit(forOrg(B), {}, { limit: 10 });
    expect(entries.map((e) => e.action)).toEqual(["organization.update"]);
  });

  it("filtre par action et par période (date de fin incluse)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const byAction = await listAudit(forOrg(A), parseAuditFilters({ action: "member.setRole" }), {
      limit: 10,
    });
    expect(byAction.entries.map((e) => e.action)).toEqual(["member.setRole"]);
    const byDay = await listAudit(forOrg(A), parseAuditFilters({ from: today, to: today }), {
      limit: 10,
    });
    expect(byDay.entries).toHaveLength(2);
    const past = await listAudit(forOrg(A), parseAuditFilters({ to: "2020-01-01" }), { limit: 10 });
    expect(past.entries).toHaveLength(0);
  });

  it("pagine du plus récent au plus ancien", async () => {
    const first = await listAudit(forOrg(A), {}, { limit: 1 });
    expect(first.nextCursor).not.toBeNull();
    const second = await listAudit(forOrg(A), {}, { limit: 1, cursor: first.nextCursor! });
    expect(second.entries[0]?.id).not.toBe(first.entries[0]?.id);
    expect(second.nextCursor).toBeNull();
  });

  it("exporte en CSV, formules neutralisées", async () => {
    const { csv, truncated } = await exportAuditCsv(forOrg(B), {}, () => "Clara <clara@b.test>");
    expect(truncated).toBe(false);
    const [header, row] = csv.trim().split("\r\n");
    expect(header).toBe(
      "date_utc,actor_type,actor,action,target_type,target_id,metadata,ip_address",
    );
    expect(row).toContain("organization.update");
    expect(row).toContain("Clara <clara@b.test>");
    // La valeur « =cmd() » est dans le JSON des métadonnées, qui ne commence pas par « = » : rien à neutraliser ici,
    // mais aucune cellule du fichier ne commence par un caractère de formule.
    for (const cell of row!.split(",")) expect(cell).not.toMatch(/^[=+\-@]/u);
  });
});

describe("ajout seul", () => {
  it("le rôle applicatif ne peut ni modifier ni supprimer une entrée", async () => {
    const db = forOrg(A);
    expect(await errorOf(db.auditLog.updateMany({ where: {}, data: { action: "x" } }))).toMatch(
      /permission denied/iu,
    );
    expect(await errorOf(db.auditLog.deleteMany({ where: {} }))).toMatch(/permission denied/iu);
  });

  it("le rôle propriétaire non plus : le trigger refuse modification et suppression", async () => {
    let updateError = "";
    let deleteError = "";
    await asMigrationRole(async (client) => {
      updateError = await errorOf(
        client.query(`UPDATE "AuditLog" SET action = 'x' WHERE "orgId" = $1`, [A]),
      );
      deleteError = await errorOf(client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [A]));
    });
    expect(updateError).toMatch(/ajout seul/u);
    expect(deleteError).toMatch(/ajout seul/u);
  });

  it("seule la purge de l'organisation, app.purge_org positionné, supprime ses entrées", async () => {
    let deleted = -1;
    let otherOrgError = "";
    await asMigrationRole(async (client) => {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.purge_org', $1, true)`, [B]);
      otherOrgError = await errorOf(client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [A]));
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.purge_org', $1, true)`, [B]);
      deleted =
        (await client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [B])).rowCount ?? -1;
      await client.query("ROLLBACK");
    });
    expect(otherOrgError).toMatch(/ajout seul/u);
    expect(deleted).toBe(1);
  });
});
