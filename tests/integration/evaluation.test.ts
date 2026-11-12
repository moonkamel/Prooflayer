// PL-401 — Évaluation sur base réelle : une preuve nouvelle ne programme que les contrôles qui acceptent son type,
// sur les systèmes qui observent sa ressource ; un job par contrôle tant qu'il attend ; évaluation historisée avec ses
// preuves et la version de l'évaluateur ; passage quotidien pour la péremption.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKey } from "@/server/crypto/envelope";
import { forOrg, prisma, withOrgTransaction } from "@/server/db";
import { LIBRARY_VERSION } from "@/server/rules/library";
import {
  evaluateInstance,
  evaluationDedupeKey,
  scheduleEvaluations,
} from "@/server/services/evaluation";
import { createEvidence } from "@/server/services/evidence";
import { LocalObjectStore } from "@/server/storage/object-store";
import { scheduleDailySweep } from "@/server/system/evaluation-sweep";
import { scheduleEvaluation } from "@/server/system/jobs/control-evaluate";
import { jobRegistry } from "@/server/system/jobs/handlers";
import { claimJobs, executeJob, runJobNow } from "@/server/system/jobs/queue";

const run = randomUUID().slice(0, 8);
const A = `org_eval_${run}`;
const ids = {
  system: `sys_eval_${run}`,
  other: `sys_eval_other_${run}`,
  archived: `sys_eval_arch_${run}`,
  resource: `res_eval_${run}`,
  unlinked: `res_eval_unlinked_${run}`,
};
/** Instances par clé de contrôle, pour chaque système. */
const instances: Record<string, Record<string, string>> = {};
let objects: string;
const master = { id: "test", key: generateKey() };

const fileSnapshot = (resourceId: string, path: string, present: boolean, takenAt: Date) => ({
  kind: "github.file.snapshot",
  source: "GITHUB" as const,
  capturedVia: "SNAPSHOT" as const,
  resourceId,
  sourceRef: `repo/file/main/${path}`,
  dedupeKey: `gh:file:${run}:${resourceId}:${path}:${present}:${takenAt.toISOString()}`,
  occurredAt: takenAt,
  summary: `${path} ${present ? "présent" : "absent"}`,
  actor: null,
  payload: {
    path,
    ref: "main",
    present,
    blobSha: present ? "abc" : null,
    size: present ? 1 : null,
  },
});

/** Insère des preuves et programme les contrôles concernés, comme le traitement d'un webhook. */
async function ingest(items: ReturnType<typeof fileSnapshot>[]) {
  return withOrgTransaction(A, async (tx) => {
    const created = [];
    for (const item of items) {
      const result = await createEvidence(tx, A, item, {
        store: new LocalObjectStore(objects),
        master,
        now: () => new Date(),
      });
      if (result.created)
        created.push({ id: result.id, kind: item.kind, resourceId: item.resourceId });
    }
    return scheduleEvaluations(tx, A, created, scheduleEvaluation);
  });
}

const jobsOf = (instanceId: string) =>
  prisma.job.findMany({ where: { dedupeKey: evaluationDedupeKey(instanceId) } });

/** Exécute les jobs en attente de l'organisation du test, et eux seuls. */
async function drainOrg() {
  for (let round = 0; round < 5; round++) {
    const queued = await prisma.job.findMany({ where: { orgId: A, status: "QUEUED" } });
    if (queued.length === 0) return;
    for (const job of queued) await runJobNow(job.id, jobRegistry);
  }
}

beforeAll(async () => {
  objects = await mkdtemp(join(tmpdir(), "pl-eval-"));
  await prisma.organization.create({ data: { id: A, name: A, slug: A } });
  const db = forOrg(A);
  for (const [id, archivedAt] of [
    [ids.system, null],
    [ids.other, null],
    [ids.archived, new Date()],
  ] as const) {
    await db.aiSystem.create({
      data: {
        id,
        orgId: A,
        name: id,
        slug: id,
        intendedPurpose: "Test",
        ownerUserId: "usr_test",
        models: [],
        archivedAt,
      },
    });
  }
  const integration = await db.integration.create({
    data: {
      orgId: A,
      provider: "GITHUB",
      externalAccountId: `ext_eval_${run}`,
      externalAccountName: "talvio-demo",
      createdByUserId: "usr_test",
    },
  });
  for (const [id, externalId] of [
    [ids.resource, "1"],
    [ids.unlinked, "2"],
  ]) {
    await db.integrationResource.create({
      data: {
        id: id!,
        orgId: A,
        integrationId: integration.id,
        kind: "github_repo",
        externalId: externalId!,
        name: id!,
        config: {},
      },
    });
  }
  // Le système principal et le système archivé observent le dépôt ; l'autre système ne l'observe pas.
  for (const systemId of [ids.system, ids.archived]) {
    await db.systemResourceLink.create({
      data: { systemId, resourceId: ids.resource, orgId: A, pathGlobs: [] },
    });
  }
  const definitions = await prisma.controlDefinition.findMany({
    where: {
      libraryVersion: LIBRARY_VERSION,
      key: { in: ["AIA-13-01", "AIA-10-01", "AIA-47-01"] },
    },
  });
  for (const systemId of [ids.system, ids.other, ids.archived]) {
    instances[systemId] = {};
    for (const d of definitions) {
      const row = await db.controlInstance.create({
        data: { orgId: A, systemId, definitionId: d.id },
      });
      instances[systemId]![d.key] = row.id;
    }
  }
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "Job" WHERE "orgId" = $1`, [A]);
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [A]);
    await client.query(`DELETE FROM "EvidenceItem" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "OrgEncryptionKey" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "Organization" WHERE id = $1`, [A]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await rm(objects, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("réévaluation incrémentale", () => {
  it("une preuve nouvelle ne programme que les contrôles concernés (type accepté, ressource observée, évaluateur livré, système actif)", async () => {
    const jobs = await ingest([
      fileSnapshot(ids.resource, "docs/ai/instructions-for-use.md", true, new Date()),
    ]);
    const main = instances[ids.system]!;
    // AIA-13-01 et AIA-10-01 acceptent github.file.snapshot ; AIA-47-01 (manuel) non, et son évaluateur arrive avec PL-405.
    expect(jobs).toHaveLength(2);
    expect((await jobsOf(main["AIA-13-01"]!))[0]?.status).toBe("QUEUED");
    expect((await jobsOf(main["AIA-10-01"]!))[0]?.status).toBe("QUEUED");
    expect(await jobsOf(main["AIA-47-01"]!)).toHaveLength(0);
    // Système non lié au dépôt, système archivé : rien.
    expect(await jobsOf(instances[ids.other]!["AIA-13-01"]!)).toHaveLength(0);
    expect(await jobsOf(instances[ids.archived]!["AIA-13-01"]!)).toHaveLength(0);
  });

  it("dédupliquée par contrôle : une seconde preuve avant l'exécution n'ajoute aucun job", async () => {
    const jobs = await ingest([
      fileSnapshot(ids.resource, "docs/ai/datasheets/train.md", true, new Date()),
    ]);
    expect(jobs).toHaveLength(0);
    expect(await jobsOf(instances[ids.system]!["AIA-10-01"]!)).toHaveLength(1);
  });

  it("le job évalue, historise preuves et version, reporte le statut et lie les preuves retenues", async () => {
    const main = instances[ids.system]!;
    const [job] = await jobsOf(main["AIA-13-01"]!);
    expect(await runJobNow(job!.id, jobRegistry)).toBe("done");
    const instance = await forOrg(A).controlInstance.findUniqueOrThrow({
      where: { id: main["AIA-13-01"]! },
      include: { evaluations: true, evidenceLinks: true },
    });
    expect(instance.status).toBe("PASS");
    expect(instance.lastEvaluatedAt).not.toBeNull();
    expect(instance.evaluations).toHaveLength(1);
    expect(instance.evaluations[0]).toMatchObject({
      status: "PASS",
      evaluatorVersion: "document.presentAndFresh@1",
    });
    expect(instance.evaluations[0]!.evidenceIds).toHaveLength(1);
    expect(
      (instance.evaluations[0]!.reasons as { message: { fr: string; en: string } }[])[0]!.message,
    ).toMatchObject({ fr: expect.any(String), en: expect.any(String) });
    expect(instance.evidenceLinks.map((l) => [l.evidenceId, l.linkedBy])).toEqual([
      [instance.evaluations[0]!.evidenceIds[0], "rule"],
    ]);
  });

  it("une preuve arrivée après l'exécution réarme le job, et l'évaluation suivante la prend en compte", async () => {
    const main = instances[ids.system]!;
    const jobs = await ingest([
      fileSnapshot(
        ids.resource,
        "docs/ai/instructions-for-use.md",
        false,
        new Date(Date.now() + 1000),
      ),
    ]);
    expect(jobs).toHaveLength(1);
    const [job] = await jobsOf(main["AIA-13-01"]!);
    expect(job).toMatchObject({ status: "QUEUED", attempts: 0 });
    expect(await runJobNow(job!.id, jobRegistry)).toBe("done");
    const instance = await forOrg(A).controlInstance.findUniqueOrThrow({
      where: { id: main["AIA-13-01"]! },
    });
    expect(instance.status).toBe("FAIL");
    expect(
      await forOrg(A).controlEvaluation.count({ where: { controlInstanceId: instance.id } }),
    ).toBe(2);
  });

  it("une preuve arrivée pendant l'exécution annule la tentative en cours : la suivante relit l'état à jour", async () => {
    const main = instances[ids.system]!;
    // Tentative en cours : le job AIA-10-01 est pris (RUNNING) puis une preuve arrive avant sa validation.
    const [job] = await jobsOf(main["AIA-10-01"]!);
    const [running] = await claimJobs(1, job!.id);
    expect(running).toBeDefined();
    const rearmed = await ingest([
      fileSnapshot(ids.resource, "docs/ai/datasheets/test.md", true, new Date()),
    ]);
    expect(rearmed).toContain(job!.id);
    // La tentative en cours ne peut plus valider : son jeton a changé.
    expect(await executeJob(running!, jobRegistry)).toBe("lease_lost");
    expect(
      await forOrg(A).controlEvaluation.count({ where: { controlInstanceId: main["AIA-10-01"]! } }),
    ).toBe(0);
    expect(await runJobNow(job!.id, jobRegistry)).toBe("done");
    const evaluation = await forOrg(A).controlEvaluation.findFirstOrThrow({
      where: { controlInstanceId: main["AIA-10-01"]! },
    });
    expect(evaluation.status).toBe("PASS");
    expect(evaluation.evidenceIds).toHaveLength(2);
  });

  it("un contrôle non applicable ou un système archivé n'est pas évalué", async () => {
    await forOrg(A).controlInstance.update({
      where: { id: instances[ids.other]!["AIA-13-01"]! },
      data: { notApplicable: true, naJustification: "Hors périmètre", status: "NOT_APPLICABLE" },
    });
    const outcomes = await withOrgTransaction(A, async (tx) => [
      await evaluateInstance(tx, A, instances[ids.other]!["AIA-13-01"]!, new Date()),
      await evaluateInstance(tx, A, instances[ids.archived]!["AIA-13-01"]!, new Date()),
      await evaluateInstance(tx, A, instances[ids.system]!["AIA-47-01"]!, new Date()),
      await evaluateInstance(tx, A, "cin_inconnue", new Date()),
    ]);
    expect(outcomes).toEqual([
      { evaluated: false, reason: "not_evaluable" },
      { evaluated: false, reason: "not_evaluable" },
      { evaluated: false, reason: "no_evaluator" },
      { evaluated: false, reason: "not_found" },
    ]);
  });
});

describe("passage quotidien", () => {
  it("un job par organisation et par jour, qui reprogramme les contrôles évaluables", async () => {
    const day = new Date("2026-11-13T02:17:00Z");
    const first = await scheduleDailySweep(day);
    expect(first.organizations).toBeGreaterThanOrEqual(1);
    const again = await scheduleDailySweep(day);
    expect(again.scheduled).toBe(0);
    const sweep = await prisma.job.findUniqueOrThrow({
      where: { dedupeKey: `control.sweepOrg:${A}:2026-11-13` },
    });
    expect(await runJobNow(sweep.id, jobRegistry)).toBe("done");
    // Contrôles évaluables : AIA-13-01 et AIA-10-01 du système principal, AIA-10-01 de l'autre système.
    const queued = await prisma.job.findMany({
      where: { orgId: A, type: "control.evaluate", status: "QUEUED" },
    });
    expect(queued.map((j) => j.dedupeKey).sort()).toEqual(
      [
        evaluationDedupeKey(instances[ids.system]!["AIA-13-01"]!),
        evaluationDedupeKey(instances[ids.system]!["AIA-10-01"]!),
        evaluationDedupeKey(instances[ids.other]!["AIA-10-01"]!),
      ].sort(),
    );
    await drainOrg();
    const other = await forOrg(A).controlInstance.findUniqueOrThrow({
      where: { id: instances[ids.other]!["AIA-10-01"]! },
    });
    // L'autre système n'observe aucun dépôt : preuve absente.
    expect(other.status).toBe("MISSING");
    expect(other.lastEvaluatedAt).not.toBeNull();
  });

  it("le cron quotidien exige le secret", async () => {
    process.env.CRON_SECRET = "secret-cron-de-test";
    const { GET } = await import("@/app/api/cron/daily/route");
    expect((await GET(new Request("http://localhost/api/cron/daily"))).status).toBe(401);
  });
});
