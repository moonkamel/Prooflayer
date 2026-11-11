// PL-107 — File de jobs dans Postgres, sur base réelle, sous le rôle applicatif.
// Effet témoin d'un job : une ligne AuditLog écrite par le gestionnaire dans la transaction du job, sous l'orgId du job.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { GET as cronDrain } from "@/app/api/cron/drain/route";
import { forOrg, prisma } from "@/server/db";
import { MAX_ATTEMPTS } from "@/server/system/jobs/backoff";
import {
  claimJobs,
  drainJobs,
  enqueue,
  executeJob,
  LEASE_MS,
  runJobNow,
} from "@/server/system/jobs/queue";
import { defineJob, JobRegistry } from "@/server/system/jobs/registry";

const run = randomUUID().slice(0, 8);
const ORG = `org_jobs_${run}`;

/** Nombre d'appels du gestionnaire, par marqueur. */
const calls = new Map<string, number>();
/** Marqueurs dont la première tentative échoue après avoir écrit son effet (interruption avant validation). */
const failFirst = new Set<string>();
/** Marqueurs qui échouent toujours. */
const alwaysFail = new Set<string>();

const effect = defineJob({
  type: `test.effect.${run}`,
  schema: z.object({ marker: z.string() }),
  async handle({ marker }, { tx, job }) {
    calls.set(marker, (calls.get(marker) ?? 0) + 1);
    await tx.auditLog.create({
      data: {
        orgId: job.orgId!,
        actorType: "system",
        action: "job.test",
        targetType: "job",
        targetId: marker,
        metadata: { attempt: job.attempts },
      },
    });
    if (alwaysFail.has(marker)) throw new Error("échec voulu");
    if (failFirst.has(marker) && job.attempts === 1) throw new Error("interruption simulée");
  },
});
const noop = defineJob({
  type: `test.noop.${run}`,
  schema: z.object({ n: z.number() }),
  async handle() {},
});
const registry = new JobRegistry([effect, noop] as never[]);

const effects = async (marker: string) =>
  (await forOrg(ORG).auditLog.findMany({ where: { targetId: marker } })).length;

async function asMigrationRole(sql: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    if (sql === "PURGE") {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.purge_org', $1, true)`, [ORG]);
      await client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [ORG]);
      await client.query("COMMIT");
      return [];
    }
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

const jobRow = async (id: string) =>
  (await prisma.job.findUniqueOrThrow({ where: { id } })) as {
    status: string;
    attempts: number;
    runAt: Date;
    lastError: string | null;
    finishedAt: Date | null;
    lockedAt: Date | null;
  };

/** Rend un job immédiatement dû (avance l'horloge du réessai) sans toucher au reste. */
const makeDue = (id: string) =>
  asMigrationRole(`UPDATE "Job" SET "runAt" = now() - interval '1 second' WHERE id = $1`, [id]);

async function enqueueEffect(marker: string) {
  const result = await enqueue(effect, { marker }, { orgId: ORG });
  if (result.deduplicated) throw new Error("inattendu");
  return result.id;
}

beforeAll(async () => {
  await prisma.organization.create({ data: { id: ORG, name: ORG, slug: ORG } });
});

afterAll(async () => {
  await asMigrationRole(`DELETE FROM "Job" WHERE type LIKE $1`, [`test.%.${run}`]);
  await asMigrationRole("PURGE");
  await asMigrationRole(`DELETE FROM "Organization" WHERE id = $1`, [ORG]);
  await prisma.$disconnect();
});

describe("enqueue", () => {
  it("valide la charge selon le schéma du type", async () => {
    await expect(enqueue(effect, { marker: 42 } as never)).rejects.toThrow();
  });

  it("ignore un second enqueue avec la même dedupeKey", async () => {
    const key = `dedupe-${run}`;
    const first = await enqueue(noop, { n: 1 }, { dedupeKey: key });
    const second = await enqueue(noop, { n: 2 }, { dedupeKey: key });
    expect(first.deduplicated).toBe(false);
    expect(second).toEqual({ id: null, deduplicated: true });
    expect(await prisma.job.count({ where: { dedupeKey: key } })).toBe(1);
    await drainJobs(registry);
  });

  it("n'exécute pas un job avant runAt", async () => {
    const result = await enqueue(noop, { n: 3 }, { runAt: new Date(Date.now() + 3_600_000) });
    expect(await claimJobs(50)).toEqual([]);
    await asMigrationRole(`DELETE FROM "Job" WHERE id = $1`, [result.id]);
  });
});

describe("exécution", () => {
  it("exécute le gestionnaire, valide son effet et marque le job DONE", async () => {
    const marker = `ok-${run}`;
    const id = await enqueueEffect(marker);
    const stats = await drainJobs(registry);
    expect(stats).toMatchObject({ claimed: 1, done: 1 });
    expect((await jobRow(id)).status).toBe("DONE");
    expect(await effects(marker)).toBe(1);
  });

  it("exécution immédiate (runNow) : une seule fois, même appelée deux fois", async () => {
    const marker = `now-${run}`;
    const id = await enqueueEffect(marker);
    expect(await runJobNow(id, registry)).toBe("done");
    expect(await runJobNow(id, registry)).toBeNull();
    expect(await effects(marker)).toBe(1);
  });

  it("type inconnu ou charge invalide : FAILED sans réessai", async () => {
    const { id } = (await prisma.job.create({
      data: { type: `test.inconnu.${run}`, payload: {} },
      select: { id: true },
    })) as { id: string };
    const bad = (await prisma.job.create({
      data: { type: effect.type, payload: { marker: 1 }, orgId: ORG },
      select: { id: true },
    })) as { id: string };
    const stats = await drainJobs(registry);
    expect(stats.failed).toBe(2);
    expect((await jobRow(id)).lastError).toMatch(/inconnu/u);
    expect((await jobRow(bad.id)).lastError).toMatch(/Charge invalide/u);
  });
});

describe("prise de lot : FOR UPDATE SKIP LOCKED", () => {
  it("deux prises concurrentes ne se partagent aucun job", async () => {
    const ids = new Set<string>();
    for (let n = 0; n < 30; n += 1) {
      const r = await enqueue(noop, { n });
      if (!r.deduplicated) ids.add(r.id);
    }
    const [a, b] = await Promise.all([claimJobs(20), claimJobs(20)]);
    const taken = [...a, ...b].map((j) => j.id).filter((id) => ids.has(id));
    expect(new Set(taken).size).toBe(taken.length);
    expect(taken.length).toBe(30);
    for (const job of [...a, ...b]) await executeJob(job, registry);
  });
});

describe("réessais exponentiels, 8 tentatives au plus", () => {
  it("replanifie après un échec, puis passe à FAILED à la 8e tentative", async () => {
    const marker = `fail-${run}`;
    alwaysFail.add(marker);
    const id = await enqueueEffect(marker);

    const before = Date.now();
    expect((await drainJobs(registry)).retry).toBe(1);
    let row = await jobRow(id);
    expect(row).toMatchObject({ status: "QUEUED", attempts: 1 });
    expect(row.lastError).toMatch(/échec voulu/u);
    const delay = row.runAt.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(27_000 - 1_000);
    expect(delay).toBeLessThanOrEqual(33_000 + 1_000);

    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await makeDue(id);
      await drainJobs(registry);
    }
    row = await jobRow(id);
    expect(row).toMatchObject({ status: "FAILED", attempts: MAX_ATTEMPTS });
    expect(row.finishedAt).not.toBeNull();
    expect(calls.get(marker)).toBe(MAX_ATTEMPTS);
    // Chaque tentative a écrit son effet puis échoué : aucun n'a été validé.
    expect(await effects(marker)).toBe(0);
  });
});

describe("une seule fois avec effet, même après un arrêt brutal", () => {
  it("échec en cours de transaction : l'effet est annulé, la tentative suivante le valide une fois", async () => {
    const marker = `interrupted-${run}`;
    failFirst.add(marker);
    const id = await enqueueEffect(marker);
    expect((await drainJobs(registry)).retry).toBe(1);
    expect(await effects(marker)).toBe(0);
    await makeDue(id);
    expect((await drainJobs(registry)).done).toBe(1);
    expect(calls.get(marker)).toBe(2);
    expect(await effects(marker)).toBe(1);
  });

  it("worker arrêté après la prise : repris seulement à l'expiration du bail, exécuté une fois", async () => {
    const marker = `crashed-${run}`;
    const id = await enqueueEffect(marker);
    const [taken] = await claimJobs(1, id); // le worker prend le job… puis s'arrête sans rien valider
    expect(taken?.id).toBe(id);
    expect((await jobRow(id)).status).toBe("RUNNING");

    // Bail en cours : aucun autre worker ne le reprend.
    expect((await drainJobs(registry)).claimed).toBe(0);

    // Bail expiré : le drainage suivant le reprend.
    await asMigrationRole(
      `UPDATE "Job" SET "lockedAt" = now() - make_interval(secs => $2) WHERE id = $1`,
      [id, LEASE_MS / 1000 + 1],
    );
    expect(await drainJobs(registry)).toMatchObject({ claimed: 1, done: 1 });
    expect((await jobRow(id)).attempts).toBe(2);
    expect(await effects(marker)).toBe(1);
  });

  it("bail repris par un second worker : le premier ne peut plus valider son effet", async () => {
    const marker = `fenced-${run}`;
    const id = await enqueueEffect(marker);
    const [first] = await claimJobs(1, id);
    await asMigrationRole(
      `UPDATE "Job" SET "lockedAt" = now() - make_interval(secs => $2) WHERE id = $1`,
      [id, LEASE_MS / 1000 + 1],
    );
    const [second] = await claimJobs(1, id);
    expect(second?.lockedAt.getTime()).not.toBe(first?.lockedAt.getTime());

    expect(await executeJob(second!, registry)).toBe("done");
    // Le premier worker se réveille avec un jeton périmé : son gestionnaire s'exécute, rien n'est validé.
    expect(await executeJob(first!, registry)).toBe("lease_lost");
    expect(calls.get(marker)).toBe(2);
    expect(await effects(marker)).toBe(1);
    expect((await jobRow(id)).status).toBe("DONE");
  });
});

describe("route cron /api/cron/drain", () => {
  const request = (authorization?: string) =>
    new Request("http://localhost/api/cron/drain", {
      headers: authorization ? { authorization } : {},
    });

  it("refuse sans secret, avec un mauvais secret, ou si le secret n'est pas configuré", async () => {
    const secret = "s".repeat(40);
    process.env.CRON_SECRET = secret;
    expect((await cronDrain(request())).status).toBe(401);
    expect((await cronDrain(request("Bearer mauvais"))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await cronDrain(request(`Bearer ${secret}`))).status).toBe(401);
  });

  it("draine la file avec le bon secret", async () => {
    const secret = "s".repeat(40);
    process.env.CRON_SECRET = secret;
    const response = await cronDrain(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      claimed: expect.any(Number),
      done: expect.any(Number),
    });
    delete process.env.CRON_SECRET;
  });
});
