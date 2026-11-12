// PL-407 — Détail d'un contrôle sur base réelle : raisons de la dernière évaluation et preuves fautives en tête,
// lien vers la source, frise de 12 semaines, preuve attendue ; assignation (membre seulement), non-applicabilité
// justifiée (admin) puis réouverture et réévaluation programmée, commentaires en ajout seul ; journal d'audit.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma } from "@/server/db";
import { LIBRARY_VERSION } from "@/server/rules/library";
import { createCaller } from "@/server/routers/_app";

const run = randomUUID().slice(0, 8);
const A = `org_ctl_${run}`;
const admin = `usr_ctl_admin_${run}`;
const contributor = `usr_ctl_contrib_${run}`;
const outsider = `usr_ctl_out_${run}`;
const ids: Record<string, string> = {};
let systemId = "";
const direct = () => new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
const as = (userId: string) =>
  createCaller({ headers: new Headers(), session: { userId, activeOrganizationId: A } });

async function expectCode(promise: Promise<unknown>, code: TRPCError["code"], message?: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(TRPCError);
  expect((error as TRPCError).code).toBe(code);
  if (message) expect((error as TRPCError).message).toBe(message);
}

beforeAll(async () => {
  await prisma.organization.create({ data: { id: A, name: A, slug: A } });
  for (const [id, role] of [
    [admin, "admin"],
    [contributor, "contributor"],
    [outsider, null],
  ] as const) {
    await prisma.user.create({ data: { id, email: `${id}@ctl.test`, name: `Nom ${id}` } });
    if (role) {
      await prisma.member.create({
        data: { id: `mem_${id}`, organizationId: A, userId: id, role },
      });
    }
  }
  const db = forOrg(A);
  systemId = (
    await db.aiSystem.create({
      data: {
        orgId: A,
        name: "Score",
        slug: `score-${run}`,
        intendedPurpose: "T",
        ownerUserId: admin,
        models: [],
      },
    })
  ).id;
  const definitions = await prisma.controlDefinition.findMany({
    where: {
      key: { in: ["AIA-15-02", "AIA-13-01", "AIA-05-01"] },
      libraryVersion: LIBRARY_VERSION,
    },
  });
  for (const d of definitions) {
    ids[d.key] = (
      await db.controlInstance.create({
        data: {
          orgId: A,
          systemId,
          definitionId: d.id,
          status: d.key === "AIA-15-02" ? "FAIL" : "MISSING",
        },
      })
    ).id;
  }
  const client = direct();
  await client.connect();
  try {
    // 25 PR liées à AIA-15-02 ; la dernière évaluation (FAIL) cite ev_…_7, une PR non approuvée.
    await client.query(
      `INSERT INTO "EvidenceItem" (id, "orgId", kind, source, "capturedVia", "sourceRef", "dedupeKey", "occurredAt",
         "capturedAt", summary, "sourceUrl", "contentSha256", "leafHash")
       SELECT 'ev_ctl_' || $2 || '_' || g, $1, 'github.pull_request.merged', 'GITHUB', 'WEBHOOK', 'ref' || g,
         'ctl:' || g, now() - make_interval(hours => g), now() - make_interval(hours => g), 'PR #' || g,
         CASE WHEN g = 1 THEN 'javascript:alert(1)' ELSE 'https://github.com/acme/score/pull/' || g END,
         decode(md5(g::text) || md5(g::text), 'hex'), decode(md5(g::text) || md5(g::text), 'hex')
       FROM generate_series(1, 25) g`,
      [A, run],
    );
    await client.query(
      `INSERT INTO "EvidenceLink" ("evidenceId", "controlInstanceId", "orgId", "linkedBy")
       SELECT 'ev_ctl_' || $2 || '_' || g, $3, $1, 'rule' FROM generate_series(1, 25) g`,
      [A, run, ids["AIA-15-02"]],
    );
    await client.query(
      `INSERT INTO "ControlEvaluation" (id, "orgId", "controlInstanceId", status, reasons, "evidenceIds",
         "evaluatorVersion", "evaluatedAt")
       VALUES ('cev_ctl_' || $2 || '_1', $1, $3, 'PASS', '[]', '{}', 'github.peerReview@1', now() - interval '20 days'),
              ('cev_ctl_' || $2 || '_2', $1, $3, 'FAIL', $4::jsonb, ARRAY['ev_ctl_' || $2 || '_7'],
               'github.peerReview@1', now() - interval '1 hour')`,
      [
        A,
        run,
        ids["AIA-15-02"],
        JSON.stringify([
          {
            code: "PR_NOT_APPROVED",
            message: {
              fr: "PR #7 fusionnée sans approbation",
              en: "PR #7 merged without approval",
            },
            evidenceIds: [`ev_ctl_${run}_7`],
          },
        ]),
      ],
    );
  } finally {
    await client.end();
  }
});

afterAll(async () => {
  const client = direct();
  await client.connect();
  try {
    await client.query(`DELETE FROM "Job" WHERE "orgId" = $1`, [A]);
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [A]);
    await client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "EvidenceItem" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "Organization" WHERE id = $1`, [A]);
    await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[admin, contributor, outsider]]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("écran D : lecture", () => {
  it("contrôle en échec : raisons listées, preuve fautive en tête, pages de 20, lien https seulement", async () => {
    const control = await as(contributor).control.get({ controlId: ids["AIA-15-02"]! });
    expect(control).toMatchObject({ key: "AIA-15-02", status: "FAIL", article: "Art. 15" });
    expect(control.lastEvaluation).toMatchObject({
      status: "FAIL",
      evaluatorVersion: "github.peerReview@1",
    });
    expect(control.lastEvaluation!.reasons[0]!.message.fr).toBe("PR #7 fusionnée sans approbation");
    expect(control.evidence).toMatchObject({ total: 25, faulty: 1, page: 1, pages: 2 });
    expect(control.evidence.items).toHaveLength(20);
    expect(control.evidence.items[0]).toMatchObject({
      id: `ev_ctl_${run}_7`,
      faulty: true,
      sourceUrl: "https://github.com/acme/score/pull/7",
    });
    const page2 = await as(contributor).control.get({ controlId: ids["AIA-15-02"]!, page: 2 });
    expect(page2.evidence.items).toHaveLength(5);
    // La plus récente (PR #1) suit la preuve fautive ; son adresse javascript: est écartée.
    expect(control.evidence.items[1]).toMatchObject({ id: `ev_ctl_${run}_1`, sourceUrl: null });
    // Frise : l'échec de cette semaine, le succès d'il y a 20 jours.
    expect(control.history).toHaveLength(12);
    expect(control.history.at(-1)!.status).toBe("FAIL");
    expect(control.history.some((h) => h.status === "PASS")).toBe(true);
    expect(control.members.map((m) => m.id).sort()).toEqual([admin, contributor].sort());
  });

  it("contrôle sans preuve : preuve attendue et convention à suivre", async () => {
    const control = await as(contributor).control.get({ controlId: ids["AIA-13-01"]! });
    expect(control.evidence.total).toBe(0);
    expect(control.lastEvaluation).toBeNull();
    expect(control.expected).toMatchObject({
      path: "docs/ai/instructions-for-use.md",
      connector: "GITHUB",
      manual: false,
    });
  });

  it("historique des évaluations, la plus récente d'abord", async () => {
    const evaluations = await as(contributor).control.evaluations({ controlId: ids["AIA-15-02"]! });
    expect(evaluations.map((e) => e.status)).toEqual(["FAIL", "PASS"]);
  });
});

describe("assignation", () => {
  it("un membre seulement ; journalisée ; personne pour désassigner", async () => {
    await expectCode(
      as(contributor).control.assignOwner({ controlId: ids["AIA-15-02"]!, ownerUserId: outsider }),
      "BAD_REQUEST",
      "control.ownerNotMember",
    );
    await as(contributor).control.assignOwner({
      controlId: ids["AIA-15-02"]!,
      ownerUserId: contributor,
    });
    const control = await as(admin).control.get({ controlId: ids["AIA-15-02"]! });
    expect(control.owner).toEqual({ id: contributor, name: `Nom ${contributor}` });
    const entry = await forOrg(A).auditLog.findFirstOrThrow({
      where: { action: "control.assign" },
    });
    expect(entry.metadata).toEqual({ before: null, after: contributor });
    await as(contributor).control.assignOwner({ controlId: ids["AIA-15-02"]!, ownerUserId: null });
    expect((await as(admin).control.get({ controlId: ids["AIA-15-02"]! })).owner).toBeNull();
  });
});

describe("non-applicabilité", () => {
  it("admin seulement, justification obligatoire ; puis rouverte et réévaluation programmée", async () => {
    const controlId = ids["AIA-05-01"]!;
    await expectCode(
      as(contributor).control.setNotApplicable({
        controlId,
        notApplicable: true,
        justification: "Aucune justification valable pour un contributeur",
      }),
      "FORBIDDEN",
    );
    await expectCode(
      as(admin).control.setNotApplicable({
        controlId,
        notApplicable: true,
        justification: "court",
      }),
      "BAD_REQUEST",
    );
    const justification =
      "Le système ne traite aucune donnée biométrique ni ne manipule le comportement.";
    await as(admin).control.setNotApplicable({ controlId, notApplicable: true, justification });
    let control = await as(admin).control.get({ controlId });
    expect(control).toMatchObject({
      status: "NOT_APPLICABLE",
      notApplicable: true,
      naJustification: justification,
      naByReclassification: false,
    });
    const entry = await forOrg(A).auditLog.findFirstOrThrow({
      where: { action: "control.setNotApplicable" },
    });
    expect(entry.metadata).toEqual({ notApplicable: true, justification });

    await as(admin).control.setNotApplicable({ controlId, notApplicable: false });
    control = await as(admin).control.get({ controlId });
    expect(control).toMatchObject({
      status: "MISSING",
      notApplicable: false,
      naJustification: null,
    });
    const job = await prisma.job.findFirst({
      where: { orgId: A, dedupeKey: `control.evaluate:${controlId}` },
    });
    expect(job?.status).toBe("QUEUED");
  });

  it("écarté par la reclassification : ne se rouvre pas à la main", async () => {
    const controlId = ids["AIA-13-01"]!;
    const client = direct();
    await client.connect();
    try {
      await client.query(
        `UPDATE "ControlInstance" SET "notApplicable" = true, "naJustification" = 'auto:reclassification',
           status = 'NOT_APPLICABLE' WHERE id = $1`,
        [controlId],
      );
    } finally {
      await client.end();
    }
    await expectCode(
      as(admin).control.setNotApplicable({ controlId, notApplicable: false }),
      "CONFLICT",
      "control.naByReclassification",
    );
    const control = await as(admin).control.get({ controlId });
    expect(control).toMatchObject({ naByReclassification: true, naJustification: null });
  });
});

describe("commentaires", () => {
  it("contributeur : ajout, ordre chronologique, texte absent du journal ; en ajout seul en base", async () => {
    const controlId = ids["AIA-15-02"]!;
    await as(contributor).control.comment({
      controlId,
      body: "  PR #7 : approbation oubliée, corrigée.  ",
    });
    await as(admin).control.comment({ controlId, body: "Merci, je relance l'évaluation." });
    const control = await as(contributor).control.get({ controlId });
    expect(control.comments.map((c) => [c.author.id, c.body])).toEqual([
      [contributor, "PR #7 : approbation oubliée, corrigée."],
      [admin, "Merci, je relance l'évaluation."],
    ]);
    const entry = await forOrg(A).auditLog.findFirstOrThrow({
      where: { action: "control.comment" },
    });
    expect(JSON.stringify(entry.metadata)).not.toContain("approbation");
    // Le rôle applicatif ne modifie ni ne supprime un commentaire.
    await expect(
      forOrg(A).controlComment.updateMany({
        where: { controlInstanceId: controlId },
        data: { body: "x" },
      }),
    ).rejects.toThrow(/permission denied/u);
    await expect(
      forOrg(A).controlComment.deleteMany({ where: { controlInstanceId: controlId } }),
    ).rejects.toThrow(/permission denied/u);
  });
});

describe("archivé", () => {
  it("fiche archivée : lecture seulement", async () => {
    await forOrg(A).aiSystem.update({ where: { id: systemId }, data: { archivedAt: new Date() } });
    await expectCode(
      as(contributor).control.comment({ controlId: ids["AIA-15-02"]!, body: "Toujours là ?" }),
      "CONFLICT",
      "system.archived",
    );
    expect(
      (await as(contributor).control.get({ controlId: ids["AIA-15-02"]! })).system.archived,
    ).toBe(true);
  });
});
