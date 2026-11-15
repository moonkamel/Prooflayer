// PL-604 — Mise en route sur base réelle : la liste avance avec l'état de l'organisation (système, classification
// signée, intégration active, première preuve capturée, pack prêt) ; capture en direct : preuves par type (ressources
// liées et preuves rattachées, hors preuves émises par ProofLayer) et contrôles « en attente » puis évalués.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma, withOrgTransaction } from "@/server/db";
import { createCaller } from "@/server/routers/_app";
import { LIBRARY_VERSION } from "@/server/rules/library";
import { createEvidence } from "@/server/services/evidence";

const run = randomUUID().slice(0, 8);
const A = `org_onb_${run}`;
const owner = `usr_onb_${run}`;
const api = () =>
  createCaller({ headers: new Headers(), session: { userId: owner, activeOrganizationId: A } });
let systemId = "";
let controlId = "";

beforeAll(async () => {
  await prisma.organization.create({ data: { id: A, name: "Talvio", slug: A } });
  await prisma.user.create({ data: { id: owner, email: `${owner}@onb.test`, name: "Clara" } });
  await prisma.member.create({
    data: { id: `mem_${owner}`, organizationId: A, userId: owner, role: "owner" },
  });
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "Job" WHERE "orgId" = $1`, [A]);
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [A]);
    for (const table of ["AuditLog", "EvidenceItem", "AuditPack", "Classification", "AiSystem"]) {
      await client.query(`DELETE FROM "${table}" WHERE "orgId" = $1`, [A]);
    }
    await client.query(`DELETE FROM "Organization" WHERE id = $1`, [A]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [owner]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("liste de mise en route", () => {
  it("avance avec l'état de l'organisation", async () => {
    expect(await api().onboarding.progress()).toMatchObject({ current: "system", done: 0 });
    systemId = (
      await forOrg(A).aiSystem.create({
        data: {
          orgId: A,
          name: "Score",
          slug: `score-${run}`,
          intendedPurpose: "Tri",
          ownerUserId: owner,
          models: [],
          monitored: true,
        },
      })
    ).id;
    expect(await api().onboarding.progress()).toMatchObject({ current: "classify", done: 1 });
    await forOrg(A).classification.create({
      data: {
        orgId: A,
        systemId,
        status: "SIGNED",
        tier: "MINIMAL",
        role: "PROVIDER",
        rulesetVersion: "test",
        answers: {},
        reasoning: [],
        signedAt: new Date(),
      } as never,
    });
    await forOrg(A).integration.create({
      data: {
        orgId: A,
        provider: "JIRA",
        externalAccountId: `cloud-${run}`,
        externalAccountName: "talvio",
        createdByUserId: owner,
      },
    });
    const progress = await api().onboarding.progress();
    expect(progress).toMatchObject({ current: "evidence", done: 3 });
    expect(progress.steps.find((s) => s.id === "evidence")!.href).toBe(
      `/systems/${systemId}/capture`,
    );
  });
});

describe("capture en direct", () => {
  it("contrôle en attente, puis preuve rattachée comptée par type et contrôle évalué", async () => {
    const definition = await prisma.controlDefinition.findFirstOrThrow({
      where: { key: "AIA-05-01", libraryVersion: LIBRARY_VERSION },
    });
    controlId = (
      await forOrg(A).controlInstance.create({
        data: { orgId: A, systemId, definitionId: definition.id },
      })
    ).id;
    const before = await api().onboarding.capture({ systemId });
    expect(before).toMatchObject({ total: 0, pending: 1, linkedSources: 0 });
    expect(before.controls[0]).toMatchObject({
      id: controlId,
      key: "AIA-05-01",
      status: "PENDING",
    });

    await withOrgTransaction(A, async (tx) => {
      const created = await createEvidence(tx, A, {
        kind: "manual.attestation",
        source: "MANUAL",
        capturedVia: "ATTESTATION",
        sourceRef: `att:${run}`,
        dedupeKey: `att:${run}`,
        occurredAt: new Date(),
        summary: "Attestation",
        payload: { statement: "x" },
        declarative: true,
      } as never);
      await tx.evidenceLink.create({
        data: { evidenceId: created.id, controlInstanceId: controlId, orgId: A, linkedBy: owner },
      });
      // Preuve émise par ProofLayer sur le système : jamais comptée comme capturée.
      await createEvidence(tx, A, {
        kind: "system.registry.snapshot",
        source: "MANUAL",
        capturedVia: "SNAPSHOT",
        sourceRef: `snap:${run}`,
        dedupeKey: `snap:${run}`,
        occurredAt: new Date(),
        summary: "Fiche",
        payload: { systemId },
      } as never);
      await tx.controlInstance.update({
        where: { id: controlId },
        data: { status: "PASS", lastEvaluatedAt: new Date() },
      });
    });
    const after = await api().onboarding.capture({ systemId });
    expect(after).toMatchObject({ total: 1, pending: 0 });
    expect(after.evidence).toEqual([{ kind: "manual.attestation", count: 1 }]);
    expect(after.controls[0]!.status).toBe("PASS");
    expect(await api().onboarding.progress()).toMatchObject({ current: "pack", done: 4 });
  });

  it("système d'une autre organisation ou inconnu : introuvable", async () => {
    await expect(api().onboarding.capture({ systemId: "sys_inconnu" })).rejects.toThrow(
      "system.notFound",
    );
  });
});
