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
import { jobRegistry } from "@/server/system/jobs/handlers";
import { runJobNow } from "@/server/system/jobs/queue";

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
    await client.query(`DELETE FROM "Job" WHERE "orgId" = ANY($1)`, [[A, B]]);
    await client.query("BEGIN");
    for (const org of [A, B]) {
      await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [org]);
      await client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [org]);
      await client.query(`DELETE FROM "AiSystem" WHERE "orgId" = $1`, [org]);
      await client.query(`DELETE FROM "Member" WHERE "organizationId" = $1`, [org]);
      await client.query(`DELETE FROM "Organization" WHERE "id" = $1`, [org]);
    }
    await client.query(`DELETE FROM "User" WHERE "id" LIKE $1`, [`usr_cls_%_${run}`]);
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

    // Retour arrière : le résultat est effacé, le chemin s'arrête à la première question sans réponse.
    const changed = await api.saveAnswers({ systemId, questionId: "annexIII", value: [] });
    expect(changed.result).toBeNull();
    expect(changed.answered).toEqual(["aiSystem", "scope", "prohibited", "annexI", "annexIII"]);
    expect(changed.current).toBe("transparency");
    // La réponse déjà donnée plus loin sur le chemin est retrouvée ; celle de la branche abandonnée est
    // écartée au calcul.
    const resumed = await api.saveAnswers({ systemId, questionId: "transparency", value: [] });
    expect(resumed.answered).toContain("developer");
    expect(resumed.current).toBeNull();
    const recomputed = await api.compute({ systemId });
    expect(recomputed.result?.tier).toBe("MINIMAL");
    expect(recomputed.responses).not.toHaveProperty("profiling");
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

  it("une requalification reprend les réponses de la version signée, résultat à recalculer", async () => {
    const { id: systemId } = await newSystem("Requalifié");
    const first = await qualify(systemId, highRisk);
    await sign(systemId);
    const api = callerFor(admin).classification;
    const draft = await api.draft({ systemId });
    expect(draft.id).not.toBe(first.id);
    expect(draft.responses).toEqual(Object.fromEntries(highRisk));
    expect(draft).toMatchObject({ status: "DRAFT", current: null, result: null });
    // Seule la réponse qui a changé est modifiée (§2.2) : plus de profilage, condition (a).
    await api.saveAnswers({ systemId, questionId: "profiling", value: false });
    const changed = await api.saveAnswers({ systemId, questionId: "art63", value: ["a"] });
    expect(changed.answered).toContain("developer");
    expect((await api.compute({ systemId })).result?.tier).toBe("HIGH_RISK_EXEMPT_ART6_3");
    const entry = await forOrg(A).auditLog.findFirst({
      where: { targetId: draft.id, action: "classification.draft" },
    });
    expect(entry?.metadata).toMatchObject({ prefilledFrom: first.id });
  });

  it("modifier la fiche ne marque « à revoir » qu'une classification signée", async () => {
    const { id: systemId } = await newSystem("Brouillon seul");
    const api = callerFor(admin);
    await api.classification.draft({ systemId });
    expect(
      await api.system.update({ id: systemId, patch: { intendedPurpose: "Autre finalité" } }),
    ).toMatchObject({ classificationStale: false });
    await qualify(systemId, highRisk);
    await sign(systemId);
    expect(
      await api.system.update({ id: systemId, patch: { intendedPurpose: "Encore une autre" } }),
    ).toMatchObject({ classificationStale: true });
  });

  it("PL-402 : la signature et la fiche deviennent des preuves ; AIA-06-01 et AIA-17-03 sont évalués", async () => {
    const { id: systemId } = await newSystem("Preuves internes");
    // Fournisseur d'un système à haut risque : packs A, B et C (AIA-17-03 est au pack C).
    await qualify(systemId, [...highRisk.slice(0, 6), ["developer", true]]);
    await sign(systemId);
    const db = forOrg(A);
    const kinds = async () =>
      (
        await db.evidenceItem.findMany({
          where: {
            kind: { startsWith: "system." },
            payload: { path: ["systemId"], equals: systemId },
          },
          orderBy: { capturedAt: "asc" },
        })
      ).map((e) => e.kind);
    expect(await kinds()).toEqual([
      "system.registry.snapshot",
      "system.classification.signed",
      "system.registry.snapshot",
    ]);
    const runQueued = async () => {
      for (const job of await prisma.job.findMany({ where: { orgId: A, status: "QUEUED" } })) {
        await runJobNow(job.id, jobRegistry);
      }
    };
    const statusOf = async (key: string) =>
      (
        await db.controlInstance.findFirstOrThrow({
          where: { systemId, definition: { key } },
        })
      ).status;
    await runQueued();
    expect(await statusOf("AIA-06-01")).toBe("PASS");
    // Responsable du système et signataire nommés, responsable du contrôle humain absent.
    expect(await statusOf("AIA-17-03")).toBe("PARTIAL");

    await callerFor(admin).system.update({
      id: systemId,
      patch: { intendedPurpose: "Finalité modifiée", oversightOwnerUserId: admin },
    });
    await runQueued();
    expect(await statusOf("AIA-06-01")).toBe("FAIL");
    expect(await statusOf("AIA-17-03")).toBe("PASS");
    const evaluation = await db.controlEvaluation.findFirstOrThrow({
      where: { controlInstance: { systemId, definition: { key: "AIA-06-01" } } },
      orderBy: { evaluatedAt: "desc" },
    });
    expect(evaluation.evaluatorVersion).toBe("internal.classificationFresh@1");
    expect((evaluation.reasons as { code: string }[])[0]!.code).toBe("CLASSIFICATION_TO_REVIEW");
  });

  it("bloque la signature après cinq mots de passe refusés, même avec le bon ensuite", async () => {
    // Un utilisateur à part : le blocage vaut par utilisateur et ne doit pas gêner les autres tests.
    const signer = `usr_cls_signer_${run}`;
    await prisma.user.create({ data: { id: signer, email: `${signer}@cls.test`, name: signer } });
    await prisma.member.create({
      data: { id: `mem_${signer}`, organizationId: A, userId: signer, role: "admin" },
    });
    const { id: systemId } = await newSystem("Essais limités");
    const draft = await qualify(systemId, highRisk);
    const attempt = (password: string) =>
      signClassification(
        { ...ctx(), userId: signer, role: "admin" },
        { systemId, name: "Signataire", title: "CTO", password, locale: "fr" },
        accept,
      ).then(
        () => "signée",
        (e: Error) => e.message,
      );
    for (let i = 0; i < 5; i++) {
      expect(await attempt(`mauvais-${i}`)).toBe("classification.invalidPassword");
    }
    expect(await attempt("bon-mot-de-passe")).toBe("classification.tooManyAttempts");
    expect((await forOrg(A).classification.findUnique({ where: { id: draft.id } }))?.status).toBe(
      "DRAFT",
    );
    const refusals = await forOrg(A).auditLog.findMany({
      where: { action: "classification.signRefused", actorId: signer },
    });
    expect(refusals).toHaveLength(5);
    expect(JSON.stringify(refusals)).not.toContain("mauvais");
    // Un autre utilisateur n'est pas bloqué.
    expect(await sign(systemId).then(() => "signée")).toBe("signée");
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

describe("contrôles ouverts à la signature (PL-207)", () => {
  const ctx = () => ({
    headers: new Headers(),
    userId: admin,
    orgId: A,
    role: "owner" as const,
    db: forOrg(A),
  });
  const sign = (systemId: string) =>
    signClassification(
      ctx(),
      { systemId, name: "Clara Martin", title: "CTO", password: "x", locale: "fr" },
      { verifyPassword: async () => true },
    );
  async function qualify(systemId: string, answers: [string, boolean | string[]][]) {
    const api = callerFor(admin).classification;
    await api.draft({ systemId });
    for (const [questionId, value] of answers) {
      await api.saveAnswers({ systemId, questionId: questionId as never, value });
    }
    await api.compute({ systemId });
    return sign(systemId);
  }
  const base: [string, boolean | string[]][] = [
    ["aiSystem", true],
    ["scope", []],
    ["prohibited", []],
    ["annexI", false],
    ["annexIII", ["4(a)"]],
  ];
  const highRiskProvider = [...base, ["profiling", true], ["developer", true]] as typeof base;
  const exempt = [
    ...base,
    ["profiling", false],
    ["art63", ["a"]],
    ["developer", true],
  ] as typeof base;
  const controls = (systemId: string) => callerFor(admin).control.listBySystem({ systemId });

  it("Talvio : fournisseur à haut risque → 37 contrôles, dont 19 automatiques, tous en attente de preuve", async () => {
    const { id: systemId } = await newSystem("Score Talvio");
    const signed = await qualify(systemId, highRiskProvider);
    expect(signed.controls).toMatchObject({ applicable: 37, created: 37, markedNotApplicable: 0 });
    const list = await controls(systemId);
    expect(list).toHaveLength(37);
    expect(list.filter((c) => c.automation === "AUTOMATED")).toHaveLength(19);
    // En attente de preuve, sauf AIA-06-02, évalué dès la signature : non concerné hors exemption (PL-205).
    expect(new Set(list.filter((c) => c.key !== "AIA-06-02").map((c) => c.status))).toEqual(
      new Set(["MISSING"]),
    );
    expect(list.find((c) => c.key === "AIA-06-02")?.status).toBe("NOT_APPLICABLE");
    expect(list[0]).toMatchObject({ key: "AIA-04-01", pack: "A", notApplicable: false });
    expect((await callerFor(admin).system.get({ id: systemId })).controlCount).toBe(37);
    const entry = await forOrg(A).auditLog.findFirst({
      where: { action: "control.instantiate", targetId: systemId },
    });
    expect(entry?.metadata).toMatchObject({ created: 37, libraryVersion: "2026.11.0" });
  });

  it("Recrutys : exempté → 6 contrôles ; reclassé haut risque → 31 de plus ; retour → 31 écartés, rien supprimé", async () => {
    const { id: systemId } = await newSystem("ATS Recrutys");
    expect((await qualify(systemId, exempt)).controls).toMatchObject({ applicable: 6, created: 6 });
    expect(await controls(systemId)).toHaveLength(6);

    // Le score de pertinence classe les candidatures : la réponse sur le profilage change (§2.2).
    const api = callerFor(admin).classification;
    await api.draft({ systemId });
    await api.saveAnswers({ systemId, questionId: "profiling", value: true });
    await api.compute({ systemId });
    expect((await sign(systemId)).controls).toMatchObject({
      applicable: 37,
      created: 31,
      markedNotApplicable: 0,
    });
    const before = await controls(systemId);
    expect(before).toHaveLength(37);

    // Retour à l'exemption : les 31 contrôles restent, marqués non applicables.
    await api.draft({ systemId });
    await api.saveAnswers({ systemId, questionId: "profiling", value: false });
    await api.saveAnswers({ systemId, questionId: "art63", value: ["a"] });
    await api.compute({ systemId });
    expect((await sign(systemId)).controls).toMatchObject({
      applicable: 6,
      created: 0,
      markedNotApplicable: 31,
    });
    const after = await controls(systemId);
    expect(after.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort());
    const setAside = after.filter((c) => c.notApplicable);
    expect(setAside).toHaveLength(31);
    expect(
      setAside.every((c) => c.status === "NOT_APPLICABLE" && c.notApplicableByReclassification),
    ).toBe(true);
    expect((await callerFor(admin).system.get({ id: systemId })).controlCount).toBe(6);

    // De nouveau haut risque : les contrôles écartés sont rouverts, pas recréés.
    await api.draft({ systemId });
    await api.saveAnswers({ systemId, questionId: "profiling", value: true });
    await api.compute({ systemId });
    expect((await sign(systemId)).controls).toMatchObject({ created: 0, reactivated: 31 });
    const reopened = await controls(systemId);
    expect(reopened.every((c) => !c.notApplicable)).toBe(true);
    expect(reopened.filter((c) => c.key !== "AIA-06-02").every((c) => c.status === "MISSING")).toBe(
      true,
    );
  });

  it("les contrôles d'une organisation sont invisibles d'une autre", async () => {
    const { id: systemId } = await newSystem("Cloisonné");
    await qualify(systemId, exempt);
    expect((await errorOf(callerFor(other, B).control.listBySystem({ systemId }))).code).toBe(
      "NOT_FOUND",
    );
    expect(await forOrg(B).controlInstance.count()).toBe(0);
  });
});
