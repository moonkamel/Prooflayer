// PL-205 — Dossier d'exemption de l'Art. 6(3) sur base réelle : rédaction, signature, contrôle AIA-06-02 satisfait,
// immuabilité, champs de l'Annexe VIII section B, document PDF. Refus par rôle : rbac.test.ts ; étanchéité :
// cross-org.test.ts et isolation.test.ts.
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma } from "@/server/db";
import { createCaller } from "@/server/routers/_app";
import { signClassification } from "@/server/services/classification";
import { renderExemptionDocument } from "@/server/services/exemption-document";
import { signDossier } from "@/server/services/exemption";

const run = randomUUID().slice(0, 8);
const A = `org_exd_${run}`;
const admin = `usr_exd_admin_${run}`;
const auditor = `usr_exd_auditor_${run}`;

const callerFor = (userId: string) =>
  createCaller({ headers: new Headers(), session: { userId, activeOrganizationId: A } });
const ctx = (userId = admin) => ({
  headers: new Headers(),
  userId,
  orgId: A,
  role: "owner" as const,
  db: forOrg(A),
});
const accept = { verifyPassword: async (p: string) => p === "bon" };

async function errorOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(TRPCError);
  return { code: (error as TRPCError).code, message: (error as TRPCError).message };
}

const base: [string, boolean | string[]][] = [
  ["aiSystem", true],
  ["scope", []],
  ["prohibited", []],
  ["annexI", false],
  ["annexIII", ["4(a)"]],
];
const exempt = [
  ...base,
  ["profiling", false],
  ["art63", ["a"]],
  ["developer", true],
] as typeof base;
const highRisk = [...base, ["profiling", true], ["developer", true]] as typeof base;

async function qualify(systemId: string, answers: typeof base) {
  const api = callerFor(admin).classification;
  await api.draft({ systemId });
  for (const [questionId, value] of answers) {
    await api.saveAnswers({ systemId, questionId: questionId as never, value });
  }
  await api.compute({ systemId });
  return signClassification(
    ctx(),
    { systemId, name: "Paul Durand", title: "CTO", password: "bon", locale: "fr" },
    accept,
  );
}

const fields = {
  conditionJustification: "Le système extrait les champs d'un CV sans les apprécier.",
  profilingJustification: "Aucun score, aucun classement de candidats.",
  providerName: "Recrutys SAS",
  providerAddress: "12 rue de la Paix, 75002 Paris",
  providerContact: "conformite@recrutys.example",
  submitter: null,
  representative: null,
  tradeName: "Recrutys ATS",
  memberStates: ["FR", "BE", "FR"] as never,
};

const control = async (systemId: string) =>
  (await callerFor(admin).control.listBySystem({ systemId })).find((c) => c.key === "AIA-06-02");

beforeAll(async () => {
  await prisma.organization.create({ data: { id: A, name: "Recrutys", slug: A } });
  for (const [id, role] of [
    [admin, "owner"],
    [auditor, "auditor"],
  ] as const) {
    await prisma.user.create({ data: { id, email: `${id}@exd.test`, name: id } });
    await prisma.member.create({ data: { id: `mem_${id}`, organizationId: A, userId: id, role } });
  }
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [A]);
    await client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "AiSystem" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "Member" WHERE "organizationId" = $1`, [A]);
    await client.query(`DELETE FROM "Organization" WHERE "id" = $1`, [A]);
    await client.query(`DELETE FROM "User" WHERE "id" = ANY($1)`, [[admin, auditor]]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("dossier d'exemption", () => {
  it("Recrutys : exempté → AIA-06-02 absent ; dossier signé → AIA-06-02 satisfait", async () => {
    const api = callerFor(admin);
    const { id: systemId } = await api.system.create({
      name: "Recrutys ATS",
      intendedPurpose: "Extrait les champs d'un CV et propose des créneaux d'entretien",
      ownerUserId: admin,
    });
    await qualify(systemId, exempt);
    expect(await control(systemId)).toMatchObject({ status: "MISSING" });

    const state = await api.exemption.get({ systemId });
    expect(state).toMatchObject({
      applicable: true,
      dossier: null,
      defaults: { providerName: "Recrutys", tradeName: "Recrutys ATS" },
      classification: { art63Conditions: ["a"], annexIIIPoints: ["4(a)"] },
    });
    expect(
      (
        await errorOf(
          api.exemption.sign({ systemId, name: "x", title: "y", password: "bon", locale: "fr" }),
        )
      ).message,
    ).toBe("exemption.noDossier");

    const saved = await api.exemption.save({ systemId, fields });
    expect(saved).toMatchObject({ status: "DRAFT", memberStates: ["BE", "FR"] });
    await api.exemption.save({ systemId, fields: { ...fields, tradeName: "Recrutys ATS v2" } });

    const signed = await signDossier(
      ctx(),
      { systemId, name: "Paul Durand", title: "CTO", password: "bon", locale: "fr" },
      accept,
    );
    expect(signed.control).toBe("PASS");
    expect(await control(systemId)).toMatchObject({ status: "PASS" });
    const after = await callerFor(auditor).exemption.get({ systemId });
    expect(after.dossier).toMatchObject({
      status: "SIGNED",
      tradeName: "Recrutys ATS v2",
      signature: {
        name: "Paul Durand",
        title: "CTO",
        statement:
          "J'atteste l'exactitude des informations de ce dossier et de l'évaluation qu'il documente.",
      },
    });

    // Évaluation historisée avec la version de l'évaluateur et les éléments utilisés.
    const evaluations = await forOrg(A).controlEvaluation.findMany({
      where: { controlInstance: { systemId, definition: { key: "AIA-06-02" } } },
      orderBy: { evaluatedAt: "asc" },
    });
    expect(evaluations.map((e) => e.status)).toEqual(["MISSING", "PASS"]);
    expect(evaluations[1]?.evaluatorVersion).toBe("internal.exemptionDossier@1");
    expect(evaluations[1]?.evidenceIds).toContain(signed.id);

    // Signé : immuable, dans le service comme en base.
    expect((await errorOf(api.exemption.save({ systemId, fields }))).message).toBe(
      "exemption.signed",
    );
    const dbError = await forOrg(A)
      .exemptionDossier.update({ where: { id: signed.id }, data: { tradeName: "Autre" } })
      .then(
        () => "",
        (e: Error) => e.message,
      );
    expect(dbError).toContain("Dossier d'exemption signé : aucune modification");

    // Annexe VIII section B.
    const json = JSON.parse(
      (await callerFor(auditor).exemption.annexViii({ systemId, format: "json" })).content,
    );
    expect(json.fields.map((f: { point: number }) => f.point)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(json.fields.find((f: { point: number }) => f.point === 6).value).toEqual(["6(3)(a)"]);
    expect(json.fields.find((f: { point: number }) => f.point === 9).value).toEqual(["BE", "FR"]);
    const csv = await api.exemption.annexViii({ systemId, format: "csv" });
    expect(csv.filename).toBe("annexe-viii-b-recrutys-ats.csv");

    // Document PDF.
    const data = await callerFor(auditor).exemption.document({ systemId });
    for (const locale of ["fr", "en"] as const) {
      const pdf = await renderExemptionDocument(data, locale, new Date());
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    }
  });

  it("reclassé haut risque : le dossier devient sans objet, AIA-06-02 non applicable", async () => {
    const api = callerFor(admin);
    const { id: systemId } = await api.system.create({
      name: "Reclassé",
      intendedPurpose: "Test",
      ownerUserId: admin,
    });
    await qualify(systemId, exempt);
    await api.exemption.save({ systemId, fields });
    await qualify(systemId, highRisk);
    expect(await control(systemId)).toMatchObject({ status: "NOT_APPLICABLE" });
    expect((await api.exemption.get({ systemId })).applicable).toBe(false);
    expect((await errorOf(api.exemption.save({ systemId, fields }))).message).toBe(
      "exemption.notExempt",
    );
    expect((await errorOf(api.exemption.document({ systemId }))).code).toBe("NOT_FOUND");
  });

  it("dossier signé après la mise sur le marché déclarée : AIA-06-02 partiel", async () => {
    const api = callerFor(admin);
    const { id: systemId } = await api.system.create({
      name: "Tardif",
      intendedPurpose: "Test",
      ownerUserId: admin,
    });
    await api.system.update({ id: systemId, patch: { placedOnMarketAt: "2026-01-15" } as never });
    await qualify(systemId, exempt);
    await api.exemption.save({ systemId, fields });
    const signed = await signDossier(
      ctx(),
      { systemId, name: "Paul Durand", title: "CTO", password: "bon", locale: "fr" },
      accept,
    );
    expect(signed.control).toBe("PARTIAL");
  });

  it("un système non exempté n'a pas de dossier", async () => {
    const api = callerFor(admin);
    const { id: systemId } = await api.system.create({
      name: "Sans exemption",
      intendedPurpose: "Test",
      ownerUserId: admin,
    });
    expect(await api.exemption.get({ systemId })).toMatchObject({
      applicable: false,
      classification: null,
    });
    expect((await errorOf(api.exemption.save({ systemId, fields }))).message).toBe(
      "exemption.notExempt",
    );
  });
});
