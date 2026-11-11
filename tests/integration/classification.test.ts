// PL-203 — Questionnaire de classification sur base réelle : brouillon unique par système, enregistrement de
// chaque réponse, reprise, retour arrière, calcul par le moteur, isolation. Refus par rôle : rbac.test.ts.
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma } from "@/server/db";
import { createCaller } from "@/server/routers/_app";

const run = randomUUID().slice(0, 8);
const A = `org_cls_a_${run}`;
const B = `org_cls_b_${run}`;
const admin = `usr_cls_admin_${run}`;
const other = `usr_cls_other_${run}`;

const callerFor = (userId: string, orgId = A) =>
  createCaller({ headers: new Headers(), session: { userId, activeOrganizationId: orgId } });

async function errorOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(TRPCError);
  return { code: (error as TRPCError).code, message: (error as TRPCError).message };
}

async function newSystem(name: string) {
  return callerFor(admin).system.create({ name, intendedPurpose: "Test", ownerUserId: admin });
}

beforeAll(async () => {
  for (const org of [A, B]) {
    await prisma.organization.create({ data: { id: org, name: org, slug: org } });
  }
  for (const [id, org] of [
    [admin, A],
    [other, B],
  ] as const) {
    await prisma.user.create({ data: { id, email: `${id}@cls.test`, name: id } });
    await prisma.member.create({
      data: { id: `mem_${id}`, organizationId: org, userId: id, role: "owner" },
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
    await client.query(`DELETE FROM "User" WHERE "id" = ANY($1)`, [[admin, other]]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("questionnaire de classification", () => {
  it("un seul brouillon par système, repris là où l'utilisateur s'est arrêté", async () => {
    const { id: systemId } = await newSystem("Repris");
    const api = callerFor(admin).classification;
    const draft = await api.draft({ systemId });
    expect(draft).toMatchObject({ current: "aiSystem", answered: [], rulesetVersion: "2026.11.0" });
    await api.saveAnswers({ systemId, questionId: "aiSystem", value: true });
    await api.saveAnswers({ systemId, questionId: "scope", value: [] });
    const resumed = await api.draft({ systemId });
    expect(resumed.id).toBe(draft.id);
    expect(resumed.answered).toEqual(["aiSystem", "scope"]);
    expect(resumed.current).toBe("prohibited");
    expect(await forOrg(A).classification.count({ where: { systemId } })).toBe(1);
  });

  it("calcule « haut risque, 4(a), fournisseur » pour le classement de candidatures", async () => {
    const { id: systemId } = await newSystem("Score d'adéquation candidat");
    const api = callerFor(admin).classification;
    await api.draft({ systemId });
    expect((await errorOf(api.compute({ systemId }))).message).toBe("classification.incomplete");
    for (const [questionId, value] of [
      ["aiSystem", true],
      ["scope", []],
      ["prohibited", []],
      ["annexI", false],
      ["annexIII", ["4(a)"]],
      ["profiling", true],
      ["developer", true],
    ] as const) {
      await api.saveAnswers({ systemId, questionId, value: value as boolean | string[] });
    }
    const computed = await api.compute({ systemId });
    expect(computed.current).toBeNull();
    expect(computed.result).toMatchObject({
      tier: "HIGH_RISK",
      role: "PROVIDER",
      annexIIIPoints: ["4(a)"],
      involvesProfiling: true,
    });
    const actions = await forOrg(A).auditLog.findMany({
      where: { targetType: "classification", targetId: computed.id },
      select: { action: true },
    });
    expect(actions.filter((a) => a.action === "classification.saveAnswers")).toHaveLength(7);
    expect(actions.map((a) => a.action)).toContain("classification.compute");

    // Retour arrière : la branche abandonnée est retirée, le résultat effacé.
    const changed = await api.saveAnswers({ systemId, questionId: "annexIII", value: [] });
    expect(changed.result).toBeNull();
    expect(changed.answered).toEqual(["aiSystem", "scope", "prohibited", "annexI", "annexIII"]);
    expect(changed.responses).not.toHaveProperty("profiling");
    expect(changed.current).toBe("transparency");
  });

  it("refuse une réponse invalide, un système archivé et l'accès d'une autre organisation", async () => {
    const { id: systemId } = await newSystem("Gardé");
    const api = callerFor(admin).classification;
    await api.draft({ systemId });
    expect(
      await errorOf(api.saveAnswers({ systemId, questionId: "annexIII", value: ["9(z)"] })),
    ).toEqual({ code: "BAD_REQUEST", message: "classification.invalidResponse" });
    expect(
      (await errorOf(api.saveAnswers({ systemId, questionId: "aiSystem", value: ["a"] }))).code,
    ).toBe("BAD_REQUEST");
    expect((await errorOf(callerFor(other, B).classification.draft({ systemId }))).code).toBe(
      "NOT_FOUND",
    );

    const { id: archived } = await newSystem("Archivé");
    await callerFor(admin).system.archive({ id: archived });
    expect(await errorOf(api.draft({ systemId: archived }))).toEqual({
      code: "CONFLICT",
      message: "system.archived",
    });
    const { id: fresh } = await newSystem("Sans brouillon");
    expect(
      (await errorOf(api.saveAnswers({ systemId: fresh, questionId: "aiSystem", value: true })))
        .message,
    ).toBe("classification.noDraft");
  });
});
