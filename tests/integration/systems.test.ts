// PL-201 — Registre des systèmes d'IA sur base réelle (rôle applicatif) : création en 3 champs, historisation
// (qui, quand, avant, après), classification « à revoir », modifications de conception qualifiées, exports, isolation.
// Le refus par rôle de chaque procédure est couvert par rbac.test.ts.
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma } from "@/server/db";
import { createCaller } from "@/server/routers/_app";

const run = randomUUID().slice(0, 8);
const A = `org_sys_a_${run}`;
const B = `org_sys_b_${run}`;
const admin = `usr_sys_admin_${run}`;
const auditor = `usr_sys_auditor_${run}`;
const other = `usr_sys_other_${run}`;

const callerFor = (userId: string, orgId = A) =>
  createCaller({ headers: new Headers(), session: { userId, activeOrganizationId: orgId } });

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(TRPCError);
  return { code: (error as TRPCError).code, message: (error as TRPCError).message };
}

beforeAll(async () => {
  for (const org of [A, B]) {
    await prisma.organization.create({ data: { id: org, name: org, slug: org } });
  }
  for (const [id, org, role] of [
    [admin, A, "admin"],
    [auditor, A, "auditor"],
    [other, B, "owner"],
  ] as const) {
    await prisma.user.create({ data: { id, email: `${id}@sys.test`, name: `Nom ${id}` } });
    await prisma.member.create({
      data: { id: `mem_${id}`, organizationId: org, userId: id, role },
    });
  }
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const org of [A, B]) {
      await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [org]);
      await client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [org]);
      await client.query(`DELETE FROM "AiSystem" WHERE "orgId" = $1`, [org]);
      await client.query(`DELETE FROM "Member" WHERE "organizationId" = $1`, [org]);
      await client.query(`DELETE FROM "Organization" WHERE "id" = $1`, [org]);
    }
    await client.query(`DELETE FROM "User" WHERE "id" = ANY($1)`, [[admin, auditor, other]]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("création et lecture", () => {
  it("crée une fiche en 3 champs, avec un slug unique dans l'organisation", async () => {
    const api = callerFor(admin);
    const first = await api.system.create({
      name: "Score d'adéquation candidat",
      intendedPurpose: "Classe les candidatures",
      ownerUserId: admin,
    });
    const second = await api.system.create({
      name: "Score d'adéquation candidat",
      intendedPurpose: "Autre",
      ownerUserId: auditor,
    });
    expect(first.slug).toBe("score-d-adequation-candidat");
    expect(second.slug).toBe("score-d-adequation-candidat-2");

    const fiche = await callerFor(auditor).system.get({ id: first.id });
    expect(fiche).toMatchObject({
      name: "Score d'adéquation candidat",
      role: "PROVIDER",
      status: "DEVELOPMENT",
      riskTier: "UNCLASSIFIED",
      owner: { id: admin, name: `Nom ${admin}` },
      models: [],
      classificationStale: false,
    });
  });

  it("refuse un responsable qui n'est pas membre de l'organisation", async () => {
    const error = await codeOf(
      callerFor(admin).system.create({ name: "X", intendedPurpose: "Y", ownerUserId: other }),
    );
    expect(error).toEqual({ code: "BAD_REQUEST", message: "system.ownerNotMember" });
  });

  it("une autre organisation ne voit ni ne modifie la fiche", async () => {
    const { id } = await callerFor(admin).system.create({
      name: "Isolé",
      intendedPurpose: "Test",
      ownerUserId: admin,
    });
    const outsider = callerFor(other, B);
    expect((await codeOf(outsider.system.get({ id }))).code).toBe("NOT_FOUND");
    expect((await codeOf(outsider.system.update({ id, patch: { name: "Volé" } }))).code).toBe(
      "NOT_FOUND",
    );
    expect((await outsider.system.list()).map((s) => s.id)).not.toContain(id);
  });
});

describe("historisation et classification à revoir", () => {
  it("historise chaque champ modifié (avant, après, auteur, date), sans entrée pour un champ inchangé", async () => {
    const api = callerFor(admin);
    const { id } = await api.system.create({
      name: "Planificateur",
      intendedPurpose: "Planifie les entretiens",
      ownerUserId: admin,
    });
    const result = await api.system.update({
      id,
      patch: {
        name: "Planificateur",
        status: "PRODUCTION",
        placedOnMarketAt: "2025-03-14",
        oversightOwnerUserId: auditor,
        dataCategories: ["CV", " cv ", "Créneaux"],
      },
    });
    // Sans classification existante, rien n'est à revoir.
    expect(result).toEqual({ changed: 4, classificationStale: false });

    const { entries: history, people } = await callerFor(auditor).system.history({ id });
    expect(people).toEqual({ [auditor]: `Nom ${auditor}` });
    expect(history.map((h) => h.action)).toEqual(["system.update", "system.create"]);
    expect(history[0]?.actor).toMatchObject({ id: admin });
    expect(Date.parse(history[0]?.at ?? "")).not.toBeNaN();
    expect(history[0]?.changes).toEqual([
      { field: "status", before: "DEVELOPMENT", after: "PRODUCTION" },
      { field: "placedOnMarketAt", before: null, after: "2025-03-14T00:00:00.000Z" },
      { field: "oversightOwnerUserId", before: null, after: auditor },
      { field: "dataCategories", before: [], after: ["CV", "Créneaux"] },
    ]);

    expect(await api.system.update({ id, patch: { status: "PRODUCTION" } })).toEqual({
      changed: 0,
      classificationStale: false,
    });
    expect((await callerFor(auditor).system.history({ id })).entries).toHaveLength(2);
  });

  it("modifier un champ de classification marque la classification courante « à revoir »", async () => {
    const api = callerFor(admin);
    const { id } = await api.system.create({
      name: "Classé",
      intendedPurpose: "Classe les candidatures",
      ownerUserId: admin,
    });
    await forOrg(A).classification.create({
      data: {
        orgId: A,
        systemId: id,
        rulesetVersion: "2026.11.0",
        answers: {},
        tier: "HIGH_RISK",
        role: "PROVIDER",
        annexIIIPoints: ["4(a)"],
        art63Conditions: [],
        reasoning: [],
        status: "SIGNED",
      },
    });

    // Champ hors classification : pas de revue.
    expect(await api.system.update({ id, patch: { description: "Détail" } })).toMatchObject({
      classificationStale: false,
    });
    const models = [{ name: "claude-sonnet", provider: "Anthropic", version: "", isGpai: true }];
    expect(await api.system.update({ id, patch: { models } })).toEqual({
      changed: 1,
      classificationStale: true,
    });

    const fiche = await api.system.get({ id });
    expect(fiche.classificationStale).toBe(true);
    expect(fiche.models).toEqual(models);
    expect(fiche.staleCause?.field).toBe("models");
    const [last] = (await api.system.history({ id })).entries;
    expect(last?.changes).toEqual([{ field: "models", before: [], after: models }]);
  });

  it("une fiche archivée sort de la surveillance et n'est plus modifiable", async () => {
    const api = callerFor(admin);
    const { id } = await api.system.create({
      name: "Ancien",
      intendedPurpose: "Retiré",
      ownerUserId: admin,
    });
    await api.system.archive({ id });
    await api.system.archive({ id }); // idempotent
    expect((await api.system.list()).map((s) => s.id)).not.toContain(id);
    expect((await api.system.list({ includeArchived: true })).map((s) => s.id)).toContain(id);
    expect(await codeOf(api.system.update({ id, patch: { name: "Nouveau" } }))).toEqual({
      code: "CONFLICT",
      message: "system.archived",
    });
    expect((await api.system.history({ id })).entries.map((h) => h.action)).toEqual([
      "system.archive",
      "system.create",
    ]);
  });
});

describe("modifications de conception", () => {
  it("s'enregistrent, se qualifient avec motif et se requalifient en gardant l'appréciation précédente", async () => {
    const api = callerFor(admin);
    const { id: systemId } = await api.system.create({
      name: "Conçu",
      intendedPurpose: "Test",
      ownerUserId: admin,
    });
    const { id } = await api.system.designChanges.create({
      systemId,
      occurredAt: "2026-03-02",
      summary: "Ajout d'un score de pertinence",
    });
    let [change] = await callerFor(auditor).system.designChanges.list({ systemId });
    expect(change).toMatchObject({ id, isSignificant: null, qualifiedBy: null });

    await api.system.designChanges.qualify({
      id,
      isSignificant: true,
      reason: "Nouvelle finalité",
    });
    await api.system.designChanges.qualify({ id, isSignificant: false, reason: "Correction" });
    [change] = await api.system.designChanges.list({ systemId });
    expect(change).toMatchObject({
      isSignificant: false,
      qualificationReason: "Correction",
      qualifiedBy: { id: admin },
    });

    const entries = await forOrg(A).auditLog.findMany({
      where: { targetType: "design_change", targetId: id, action: "designChange.qualify" },
      orderBy: { createdAt: "asc" },
    });
    expect(entries.map((e) => e.metadata)).toEqual([
      {
        systemId,
        before: { isSignificant: null, reason: null },
        after: { isSignificant: true, reason: "Nouvelle finalité" },
      },
      {
        systemId,
        before: { isSignificant: true, reason: "Nouvelle finalité" },
        after: { isSignificant: false, reason: "Correction" },
      },
    ]);
  });

  it("le motif est obligatoire et une autre organisation ne peut pas qualifier", async () => {
    const api = callerFor(admin);
    const { id: systemId } = await api.system.create({
      name: "Motif",
      intendedPurpose: "Test",
      ownerUserId: admin,
    });
    const { id } = await api.system.designChanges.create({
      systemId,
      occurredAt: "2026-01-01",
      summary: "Changement",
    });
    expect(
      (await codeOf(api.system.designChanges.qualify({ id, isSignificant: true, reason: " " })))
        .code,
    ).toBe("BAD_REQUEST");
    expect(
      (
        await codeOf(
          callerFor(other, B).system.designChanges.qualify({
            id,
            isSignificant: true,
            reason: "x",
          }),
        )
      ).code,
    ).toBe("NOT_FOUND");
  });
});

describe("exports", () => {
  it("CSV et JSON contiennent toutes les fiches de l'organisation, archivées comprises, et seulement elles", async () => {
    const api = callerFor(auditor);
    const csv = await api.system.export({ format: "csv" });
    const json = await api.system.export({ format: "json" });
    expect(csv.filename).toMatch(/^registre-systemes-ia-\d{4}-\d{2}-\d{2}\.csv$/u);
    expect(json.mimeType).toBe("application/json");

    const systems = (JSON.parse(json.content) as { systems: { name: string; owner: string }[] })
      .systems;
    const names = systems.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["Ancien", "Classé", "Planificateur", "Isolé"]));
    expect(systems.find((s) => s.name === "Planificateur")?.owner).toBe(
      `Nom ${admin} <${admin}@sys.test>`,
    );
    expect(csv.content.split("\r\n").filter(Boolean)).toHaveLength(names.length + 1);

    const outsider = await callerFor(other, B).system.export({ format: "json" });
    expect(JSON.parse(outsider.content).systems).toEqual([]);
  });
});
