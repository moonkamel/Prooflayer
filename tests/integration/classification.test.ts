// PL-203 — Questionnaire de classification sur base réelle : brouillon unique par système, enregistrement de
// chaque réponse, reprise, retour arrière, calcul par le moteur, isolation. Refus par rôle : rbac.test.ts.
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma } from "@/server/db";
import { createCaller } from "@/server/routers/_app";
import { classificationNote, signClassification } from "@/server/services/classification";
import { renderClassificationNote } from "@/server/services/classification-note";

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

describe("signature (PL-204)", () => {
  const ctx = () => ({
    headers: new Headers(),
    userId: admin,
    orgId: A,
    role: "owner" as const,
    db: forOrg(A),
  });
  const accept = { verifyPassword: async (p: string) => p === "bon-mot-de-passe" };
  const sign = (systemId: string, password = "bon-mot-de-passe") =>
    signClassification(
      ctx(),
      { systemId, name: "Clara Martin", title: "CTO", password, locale: "fr" },
      accept,
    );

  async function qualify(systemId: string, answers: [string, boolean | string[]][]) {
    const api = callerFor(admin).classification;
    await api.draft({ systemId });
    for (const [questionId, value] of answers) {
      await api.saveAnswers({ systemId, questionId: questionId as never, value });
    }
    return api.compute({ systemId });
  }
  const highRisk: [string, boolean | string[]][] = [
    ["aiSystem", true],
    ["scope", []],
    ["prohibited", []],
    ["annexI", false],
    ["annexIII", ["4(a)"]],
    ["profiling", true],
    ["developer", false],
    ["art25", []],
  ];

  it("signe, met la fiche à jour, historise le rôle et fige la classification", async () => {
    const { id: systemId } = await newSystem("Signé");
    const api = callerFor(admin);
    expect(
      (
        await errorOf(
          api.classification.sign({
            systemId,
            name: "x",
            title: "y",
            password: "z",
            locale: "fr",
          }),
        )
      ).message,
    ).toBe("classification.noDraft");
    const draft = await qualify(systemId, highRisk);

    expect(
      await sign(systemId, "mauvais").then(
        () => null,
        (e: Error) => e.message,
      ),
    ).toBe("classification.invalidPassword");
    expect((await forOrg(A).classification.findUnique({ where: { id: draft.id } }))?.status).toBe(
      "DRAFT",
    );

    await sign(systemId);
    const current = await api.classification.current({ systemId });
    expect(current.draft).toBeNull();
    expect(current.signed).toMatchObject({
      id: draft.id,
      status: "SIGNED",
      signature: {
        name: "Clara Martin",
        title: "CTO",
        statement: "J'atteste l'exactitude des réponses fournies.",
      },
    });
    const fiche = await api.system.get({ id: systemId });
    expect(fiche).toMatchObject({
      riskTier: "HIGH_RISK",
      annexIIIPoints: ["4(a)"],
      role: "DEPLOYER",
      classificationStale: false,
    });
    const history = await api.system.history({ id: systemId });
    expect(history.entries[0]?.changes).toEqual([
      { field: "role", before: "PROVIDER", after: "DEPLOYER" },
    ]);

    // Immuable en base, même hors du service (trigger classification_guard).
    const error = await forOrg(A)
      .classification.update({ where: { id: draft.id }, data: { tier: "MINIMAL" } })
      .then(
        () => "",
        (e: Error) => e.message,
      );
    expect(error).toContain("Classification signée : aucune modification");
  });

  it("une nouvelle signature remplace la précédente ; l'historique garde les deux versions", async () => {
    const { id: systemId } = await newSystem("Versions");
    const first = await qualify(systemId, highRisk);
    await sign(systemId);
    const second = await qualify(systemId, [
      ["aiSystem", true],
      ["scope", []],
      ["prohibited", []],
      ["annexI", false],
      ["annexIII", ["4(a)"]],
      ["profiling", false],
      ["art63", ["a"]],
      ["developer", true],
    ]);
    expect(second.id).not.toBe(first.id);
    await sign(systemId);
    const versions = await callerFor(admin).classification.history({ systemId });
    expect(versions.map((v) => [v.id, v.status, v.tier])).toEqual([
      [second.id, "SIGNED", "HIGH_RISK_EXEMPT_ART6_3"],
      [first.id, "SUPERSEDED", "HIGH_RISK"],
    ]);
    const superseded = await forOrg(A)
      .classification.update({ where: { id: first.id }, data: { status: "SIGNED" } })
      .then(
        () => "",
        (e: Error) => e.message,
      );
    expect(superseded).toContain("aucune modification");
  });

  it("une pratique interdite ne se signe pas", async () => {
    const { id: systemId } = await newSystem("Interdit");
    await qualify(systemId, [
      ["aiSystem", true],
      ["scope", []],
      ["prohibited", ["f"]],
      ["developer", true],
    ]);
    expect(
      await sign(systemId).then(
        () => null,
        (e: Error) => e.message,
      ),
    ).toBe("classification.prohibited");
  });

  it("produit la note PDF, en français et en anglais", async () => {
    const { id: systemId } = await newSystem("Note PDF");
    const draft = await qualify(systemId, highRisk);
    await sign(systemId);
    const data = await classificationNote(ctx(), { systemId, classificationId: draft.id });
    for (const locale of ["fr", "en"] as const) {
      const pdf = await renderClassificationNote(data, locale, new Date("2026-11-11T00:00:00Z"));
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(2000);
    }
    expect(
      (
        await errorOf(
          callerFor(other, B).classification.note({ systemId, classificationId: draft.id }),
        )
      ).code,
    ).toBe("NOT_FOUND");
  });
});
