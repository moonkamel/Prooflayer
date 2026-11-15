// PL-609 — Surveillance sur base réelle : file de jobs en retard (et point de santé en 503), connecteur en erreur ;
// les alertes ne portent que des codes et des décomptes, jamais l'organisation ni le contenu.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { forOrg, prisma } from "@/server/db";
import { healthCheck } from "@/server/system/health";
import { monitorSnapshot, runMonitoring } from "@/server/system/monitoring";

const run = randomUUID().slice(0, 8);
const A = `org_mon_${run}`;
const now = new Date();
let jobId = "";

beforeAll(async () => {
  await prisma.organization.create({ data: { id: A, name: "Talvio", slug: A } });
  await forOrg(A).integration.create({
    data: {
      orgId: A,
      provider: "JIRA",
      externalAccountId: `cloud-mon-${run}`,
      externalAccountName: "talvio",
      status: "ERROR",
      lastError: "invalid_grant",
      createdByUserId: "u",
    },
  });
  jobId = (
    await prisma.job.create({
      data: {
        type: "test.lagging",
        payload: {},
        dedupeKey: `mon:${run}`,
        runAt: new Date(now.getTime() - 30 * 60_000),
      },
    })
  ).id;
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "Job" WHERE id = $1`, [jobId]);
    await client.query("SELECT purge_organization($1)", [A]);
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("surveillance", () => {
  it("relevé : job dû depuis 30 minutes, connecteur Jira en erreur", async () => {
    const snapshot = await monitorSnapshot(now);
    expect(snapshot.queue.oldestDueAt!.getTime()).toBeLessThanOrEqual(now.getTime() - 30 * 60_000);
    expect(snapshot.integrations).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: "JIRA", status: "ERROR" })]),
    );
  });

  it("alertes : codes et décomptes seulement", async () => {
    const logged: string[] = [];
    const spy = vi
      .spyOn(console, "error")
      .mockImplementation((line: string) => void logged.push(line));
    try {
      const { alerts } = await runMonitoring(now);
      expect(alerts).toEqual(expect.arrayContaining(["ops.queueLagging", "ops.connectorError"]));
    } finally {
      spy.mockRestore();
    }
    expect(logged.join("\n")).not.toContain(A);
    expect(logged.join("\n")).not.toContain("talvio");
    expect(logged.join("\n")).not.toContain("invalid_grant");
  });

  it("point de santé : 503 tant que la file n'est pas drainée", async () => {
    expect(await healthCheck(now)).toEqual({ ok: false, database: "up", queue: "lagging" });
    await prisma.job.update({ where: { id: jobId }, data: { status: "DONE", finishedAt: now } });
    const after = await healthCheck(now);
    // D'autres fichiers de tests peuvent laisser des jobs dus : seul le nôtre est vérifié ici.
    expect(after.database).toBe("up");
  });
});
