// §4.7 — « test automatisé qui tente pour chaque procédure de lire une ressource d'une autre organisation et attend
// un refus ». Les procédures sont énumérées depuis le routeur : chacune doit figurer ici, soit avec une entrée qui
// désigne une ressource de l'organisation A (appelée par un owner de B → refus attendu), soit dans la liste des
// procédures sans identifiant de ressource (portée par l'organisation active, couverte par isolation.test.ts).
// Une procédure ajoutée sans être classée fait échouer le test « inventaire ».
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signState } from "@/server/connectors/jira/oauth";
import { signToken } from "@/server/crypto/signed-token";
import { LIBRARY_VERSION } from "@/server/rules/library";
import { generateKey } from "@/server/crypto/envelope";
import { forOrg, prisma } from "@/server/db";
import { appRouter, createCaller } from "@/server/routers/_app";

const run = randomUUID().slice(0, 8);
const A = `org_xorg_a_${run}`;
const B = `org_xorg_b_${run}`;
const ownerA = `usr_xorg_a_${run}`;
const ownerB = `usr_xorg_b_${run}`;
const invitationA = `inv_xorg_${run}`;

const callerFor = (userId: string, orgId: string) =>
  createCaller({ headers: new Headers(), session: { userId, activeOrganizationId: orgId } });

/** Ressources de l'organisation A, créées avant les tests. */
const a = {
  systemId: "",
  designChangeId: "",
  classificationId: "",
  controlInstanceId: "",
  memberId: `mem_${ownerA}`,
};

type Refusal = "NOT_FOUND" | "BAD_REQUEST";

/** Entrée désignant une ressource de A, et refus attendu quand un membre de B l'envoie. */
const CROSS_ORG: Record<string, () => { input: unknown; code: Refusal }> = {
  "org.members.setRole": () => ({
    input: { memberId: a.memberId, role: "auditor" },
    code: "NOT_FOUND",
  }),
  "org.members.remove": () => ({ input: { memberId: a.memberId }, code: "NOT_FOUND" }),
  "org.members.revokeInvitation": () => ({
    input: { invitationId: invitationA },
    code: "NOT_FOUND",
  }),
  "system.get": () => ({ input: { id: a.systemId }, code: "NOT_FOUND" }),
  "system.history": () => ({ input: { id: a.systemId }, code: "NOT_FOUND" }),
  "system.update": () => ({
    input: { id: a.systemId, patch: { name: "Pris" } },
    code: "NOT_FOUND",
  }),
  "system.archive": () => ({ input: { id: a.systemId }, code: "NOT_FOUND" }),
  // Le responsable désigné appartient à A : une référence vers une autre organisation est refusée.
  "system.create": () => ({
    input: { name: "Croisé", intendedPurpose: "Test", ownerUserId: ownerA },
    code: "BAD_REQUEST",
  }),
  "system.designChanges.list": () => ({ input: { systemId: a.systemId }, code: "NOT_FOUND" }),
  "system.designChanges.create": () => ({
    input: { systemId: a.systemId, occurredAt: "2026-01-01", summary: "Croisé" },
    code: "NOT_FOUND",
  }),
  "system.designChanges.qualify": () => ({
    input: { id: a.designChangeId, isSignificant: true, reason: "Croisé" },
    code: "NOT_FOUND",
  }),
  "control.listBySystem": () => ({ input: { systemId: a.systemId }, code: "NOT_FOUND" }),
  "control.get": () => ({ input: { controlId: a.controlInstanceId }, code: "NOT_FOUND" }),
  "evidence.proof": () => ({ input: { evidenceId: "ev_de_A_inexistante" }, code: "NOT_FOUND" }),
  "pack.create": () => ({
    input: {
      systemId: a.systemId,
      periodStart: "2026-11-01",
      periodEnd: "2026-11-10",
      language: "fr",
    },
    code: "NOT_FOUND",
  }),
  "pack.list": () => ({ input: { systemId: a.systemId }, code: "NOT_FOUND" }),
  "pack.preview": () => ({
    input: { systemId: a.systemId, periodStart: "2026-11-01", periodEnd: "2026-11-10" },
    code: "NOT_FOUND",
  }),
  "pack.get": () => ({ input: { packId: "pck_de_A" }, code: "NOT_FOUND" }),
  "pack.downloadUrl": () => ({ input: { packId: "pck_de_A" }, code: "NOT_FOUND" }),
  "pack.download": () => ({ input: { packId: "pck_de_A" }, code: "NOT_FOUND" }),
  "control.evaluations": () => ({ input: { controlId: a.controlInstanceId }, code: "NOT_FOUND" }),
  "control.assignOwner": () => ({
    input: { controlId: a.controlInstanceId, ownerUserId: null },
    code: "NOT_FOUND",
  }),
  "control.setNotApplicable": () => ({
    input: {
      controlId: a.controlInstanceId,
      notApplicable: true,
      justification: "Justification suffisamment longue pour passer la validation.",
    },
    code: "NOT_FOUND",
  }),
  "control.comment": () => ({
    input: { controlId: a.controlInstanceId, body: "Commentaire" },
    code: "NOT_FOUND",
  }),
  "dashboard.systemSummary": () => ({ input: { systemId: a.systemId }, code: "NOT_FOUND" }),
  "dashboard.coverageTimeline": () => ({ input: { systemId: a.systemId }, code: "NOT_FOUND" }),
  "exemption.get": () => ({ input: { systemId: a.systemId }, code: "NOT_FOUND" }),
  "exemption.annexViii": () => ({
    input: { systemId: a.systemId, format: "json" },
    code: "NOT_FOUND",
  }),
  "exemption.document": () => ({ input: { systemId: a.systemId }, code: "NOT_FOUND" }),
  "exemption.save": () => ({
    input: {
      systemId: a.systemId,
      fields: {
        conditionJustification: "x",
        profilingJustification: "x",
        providerName: "x",
        providerAddress: "x",
        providerContact: "x",
        submitter: null,
        representative: null,
        tradeName: "x",
        memberStates: [],
      },
    },
    code: "NOT_FOUND",
  }),
  "exemption.sign": () => ({
    input: { systemId: a.systemId, name: "X", title: "Y", password: "z", locale: "fr" },
    code: "NOT_FOUND",
  }),
  "classification.current": () => ({ input: { systemId: a.systemId }, code: "NOT_FOUND" }),
  "classification.history": () => ({ input: { systemId: a.systemId }, code: "NOT_FOUND" }),
  "classification.note": () => ({
    input: { systemId: a.systemId, classificationId: a.classificationId },
    code: "NOT_FOUND",
  }),
  "classification.draft": () => ({ input: { systemId: a.systemId }, code: "NOT_FOUND" }),
  "classification.saveAnswers": () => ({
    input: { systemId: a.systemId, questionId: "aiSystem", value: false },
    code: "NOT_FOUND",
  }),
  "classification.compute": () => ({ input: { systemId: a.systemId }, code: "NOT_FOUND" }),
  "classification.sign": () => ({
    input: { systemId: a.systemId, name: "X", title: "Y", password: "z", locale: "fr" },
    code: "NOT_FOUND",
  }),
  // Correspondances Jira (PL-404) : un système ou une intégration de A est introuvable depuis B.
  "integration.jira.mappings": () => ({ input: { systemId: a.systemId }, code: "NOT_FOUND" }),
  "integration.jira.saveMapping": () => ({
    input: { systemId: a.systemId, purpose: "risks", jql: "labels = ai-risk" },
    code: "NOT_FOUND",
  }),
  "integration.jira.previewQuery": () => ({
    input: { integrationId: "int_de_a", jql: "labels = ai-risk" },
    code: "NOT_FOUND",
  }),
  // Preuves manuelles (PL-405) : un contrôle de A est introuvable depuis B ; un jeton de dépôt émis pour A est refusé.
  "evidence.createUploadUrl": () => ({
    input: {
      controlInstanceIds: [a.controlInstanceId],
      filename: "x.pdf",
      contentType: "application/pdf",
      size: 10,
    },
    code: "NOT_FOUND",
  }),
  "evidence.attest": () => ({
    input: {
      controlInstanceIds: [a.controlInstanceId],
      statement: "Déclaration croisée de test",
      name: "X",
      title: "Y",
      validUntil: "2099-01-01",
      password: "z",
    },
    code: "NOT_FOUND",
  }),
  "evidence.registerUpload": () => ({
    input: {
      token: signToken(
        {
          orgId: A,
          userId: ownerA,
          uploadId: "u",
          key: "k",
          filename: "x.pdf",
          contentType: "application/pdf",
          controlInstanceIds: [],
        },
        {
          secret: process.env.BETTER_AUTH_SECRET!,
          purpose: "evidence-upload",
          expiresAt: new Date(Date.now() + 60_000),
        },
      ),
      validUntil: "2099-01-01",
    },
    code: "BAD_REQUEST",
  }),
  // Un state de connexion Jira émis pour l'organisation A ne lie rien à B.
  "integration.jira.complete": () => ({
    input: {
      code: "code",
      state: signState({ orgId: A, userId: ownerA }, process.env.BETTER_AUTH_SECRET!, new Date()),
    },
    code: "BAD_REQUEST",
  }),
};

/** Procédures sans identifiant de ressource : elles ne portent que sur l'organisation active. */
const ORG_SCOPED = [
  "notification.list",
  "notification.markRead",
  "notification.preferences.get",
  "notification.preferences.set",
  "dashboard.orgSummary",
  "org.get",
  "org.update",
  "org.members.list",
  "org.members.invite",
  "org.members.invitations",
  "audit.list",
  "audit.export",
  "system.list",
  "system.export",
  "integration.jira.authorizeUrl",
];

const paths = Object.keys(appRouter._def.procedures as unknown as Record<string, unknown>);

function call(caller: ReturnType<typeof callerFor>, path: string, input: unknown) {
  const fn = path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], caller);
  return (fn as (input?: unknown) => Promise<unknown>)(input);
}

beforeAll(async () => {
  // Application OAuth Jira factice : la procédure va jusqu'à la vérification du state.
  process.env.JIRA_CLIENT_ID ??= "client-test";
  process.env.JIRA_CLIENT_SECRET ??= "secret-test";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
  process.env.PROOFLAYER_MASTER_KEY ??= generateKey().toString("base64");
  // Le job CI `db` ne définit pas de secret d'authentification : un secret propre à ce test signe le state.
  process.env.BETTER_AUTH_SECRET ??= "cross-org-test-secret-0123456789-0123456789";
  for (const [org, user] of [
    [A, ownerA],
    [B, ownerB],
  ] as const) {
    await prisma.organization.create({ data: { id: org, name: org, slug: org } });
    await prisma.user.create({ data: { id: user, email: `${user}@xorg.test`, name: user } });
    await prisma.member.create({
      data: { id: `mem_${user}`, organizationId: org, userId: user, role: "owner" },
    });
  }
  await prisma.invitation.create({
    data: {
      id: invitationA,
      organizationId: A,
      email: `invite-${run}@xorg.test`,
      role: "auditor",
      expiresAt: new Date(Date.now() + 86_400_000),
      inviterId: ownerA,
    },
  });
  const api = callerFor(ownerA, A);
  a.systemId = (
    await api.system.create({ name: "Système de A", intendedPurpose: "Test", ownerUserId: ownerA })
  ).id;
  a.designChangeId = (
    await api.system.designChanges.create({
      systemId: a.systemId,
      occurredAt: "2026-01-01",
      summary: "Changement de A",
    })
  ).id;
  await api.classification.draft({ systemId: a.systemId });
  await api.classification.saveAnswers({
    systemId: a.systemId,
    questionId: "aiSystem",
    value: false,
  });
  await api.classification.saveAnswers({
    systemId: a.systemId,
    questionId: "developer",
    value: true,
  });
  a.classificationId = (await api.classification.compute({ systemId: a.systemId })).id;
  const definition = await prisma.controlDefinition.findFirstOrThrow({
    where: { key: "AIA-05-01", libraryVersion: LIBRARY_VERSION },
  });
  a.controlInstanceId = (
    await forOrg(A).controlInstance.create({
      data: { orgId: A, systemId: a.systemId, definitionId: definition.id },
    })
  ).id;
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
      await client.query(`DELETE FROM "Organization" WHERE "id" = $1`, [org]);
    }
    await client.query(`DELETE FROM "User" WHERE "id" = ANY($1)`, [[ownerA, ownerB]]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("inventaire", () => {
  it("chaque procédure est classée : ressource d'une autre organisation, ou portée par l'organisation active", () => {
    const classified = [...Object.keys(CROSS_ORG), ...ORG_SCOPED].sort();
    expect(classified).toEqual([...paths].sort());
  });
});

describe("ressource d'une autre organisation → refus", () => {
  it.each(Object.keys(CROSS_ORG))("%s", async (path) => {
    const { input, code } = CROSS_ORG[path]!();
    const error = await call(callerFor(ownerB, B), path, input).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error, `${path} aurait dû être refusé`).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).code).toBe(code);
  });

  it("le propriétaire de la ressource, lui, y accède : les entrées du test sont valides", async () => {
    const api = callerFor(ownerA, A);
    expect((await api.system.get({ id: a.systemId })).name).toBe("Système de A");
    expect((await api.classification.current({ systemId: a.systemId })).draft?.id).toBe(
      a.classificationId,
    );
    expect(await api.system.designChanges.list({ systemId: a.systemId })).toHaveLength(1);
  });

  it("rien n'a été modifié dans l'organisation A", async () => {
    const system = await forOrg(A).aiSystem.findUnique({ where: { id: a.systemId } });
    expect(system).toMatchObject({ name: "Système de A", archivedAt: null });
    expect(await forOrg(A).aiSystem.count()).toBe(1);
    expect(await forOrg(B).aiSystem.count()).toBe(0);
    const change = await forOrg(A).designChange.findUnique({ where: { id: a.designChangeId } });
    expect(change?.isSignificant).toBeNull();
    expect((await prisma.member.findUnique({ where: { id: a.memberId } }))?.role).toBe("owner");
    expect((await prisma.invitation.findUnique({ where: { id: invitationA } }))?.status).toBe(
      "pending",
    );
  });
});
