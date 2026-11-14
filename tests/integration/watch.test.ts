// PL-603 — Fil de veille sur base réelle : une entrée du fichier versionné est publiée à sa date dans la table système
// `RegulatoryUpdate`, les owners et admins de chaque organisation reçoivent une notification et un email (une seule
// fois), jamais les contributeurs ; l'écran relie les contrôles concernés aux contrôles de l'organisation.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma } from "@/server/db";
import type { EmailMessage } from "@/server/email/transport";
import { createCaller } from "@/server/routers/_app";
import { LIBRARY_VERSION } from "@/server/rules/library";
import { sendNotificationEmail } from "@/server/services/notifications";
import { jobRegistry } from "@/server/system/jobs/handlers";
import { runJobNow } from "@/server/system/jobs/queue";
import { watchAudience } from "@/server/system/jobs/watch";
import { scheduleWatchNotifications } from "@/server/system/regulatory-watch";
import { WATCH_ENTRIES, type WatchEntry } from "@/server/watch/entries";

const run = randomUUID().slice(0, 8);
const A = `org_watch_${run}`;
const owner = `usr_watch_owner_${run}`;
const admin = `usr_watch_admin_${run}`;
const contributor = `usr_watch_contrib_${run}`;
const entry: WatchEntry = {
  ...WATCH_ENTRIES[0]!,
  id: `2026-11-14-test-${run}`,
  publishedAt: "2026-11-14",
  title: { fr: "Entrée de test", en: "Test entry" },
  controls: ["AIA-05-01", "AIA-09-01"],
};
const future: WatchEntry = { ...entry, id: `2099-01-01-futur-${run}`, publishedAt: "2099-01-01" };
let systemId = "";
let controlId = "";

beforeAll(async () => {
  await prisma.organization.create({ data: { id: A, name: "Talvio", slug: A } });
  for (const [id, role] of [
    [owner, "owner"],
    [admin, "admin"],
    [contributor, "contributor"],
  ] as const) {
    await prisma.user.create({ data: { id, email: `${id}@watch.test`, name: role } });
    await prisma.member.create({ data: { id: `mem_${id}`, organizationId: A, userId: id, role } });
  }
  // Base partagée entre fichiers de tests : seuls les membres de cette organisation sont prévenus.
  watchAudience.members = () =>
    prisma.member.findMany({
      where: { organizationId: A },
      select: { organizationId: true, userId: true, role: true },
    });
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
  const definition = await prisma.controlDefinition.findFirstOrThrow({
    where: { key: "AIA-05-01", libraryVersion: LIBRARY_VERSION },
  });
  controlId = (
    await forOrg(A).controlInstance.create({
      data: { orgId: A, systemId, definitionId: definition.id },
    })
  ).id;
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "RegulatoryUpdate" WHERE id = ANY($1)`, [
      [entry.id, future.id],
    ]);
    await client.query(`DELETE FROM "Job" WHERE "dedupeKey" LIKE $1 OR "orgId" = $2`, [
      `%${run}%`,
      A,
    ]);
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [A]);
    await client.query(`DELETE FROM "AiSystem" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "Organization" WHERE id = $1`, [A]);
    await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[owner, admin, contributor]]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

async function runWatchJob() {
  const job = await prisma.job.findFirstOrThrow({
    where: { dedupeKey: `watch.notify:${entry.id}` },
  });
  await runJobNow(job.id, jobRegistry);
}

describe("publication et notification", () => {
  it("publiée à sa date ; une entrée future n'est ni publiée ni annoncée", async () => {
    const now = new Date("2026-11-14T06:00:00Z");
    const result = await scheduleWatchNotifications(now, [entry, future]);
    expect(result.published).toBe(1);
    expect(await prisma.regulatoryUpdate.findUnique({ where: { id: future.id } })).toBeNull();
    expect(
      await prisma.regulatoryUpdate.findUniqueOrThrow({ where: { id: entry.id } }),
    ).toMatchObject({
      impactedControlKeys: ["AIA-05-01", "AIA-09-01"],
      notifiedAt: null,
    });
  });

  it("owner et admin prévenus, jamais le contributeur ; un seul email chacun", async () => {
    await runWatchJob();
    const notifications = await forOrg(A).notification.findMany({
      where: { type: "watch.published" },
    });
    expect(notifications.map((n) => n.userId).sort()).toEqual([admin, owner].sort());
    expect(
      (await prisma.regulatoryUpdate.findUniqueOrThrow({ where: { id: entry.id } })).notifiedAt,
    ).not.toBeNull();
    const sent: EmailMessage[] = [];
    const deps = {
      transport: { send: async (m: EmailMessage) => void sent.push(m) },
      baseUrl: "https://app.example.test",
      now: () => new Date(),
    };
    for (const n of notifications) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.org_id', ${A}, TRUE)`;
        expect(await sendNotificationEmail(tx as never, A, n.id, deps as never)).toBe("sent");
        expect(await sendNotificationEmail(tx as never, A, n.id, deps as never)).toBe("skipped");
      });
    }
    expect(sent).toHaveLength(2);
    expect(sent[0]!.subject).toBe("Veille réglementaire : Entrée de test");
    expect(sent[0]!.text).toContain(`https://app.example.test/watch#${entry.id}`);
    expect(sent[0]!.text).toContain("Contrôles concernés : AIA-05-01, AIA-09-01.");
  });

  it("le lendemain : rien n'est annoncé une seconde fois", async () => {
    const result = await scheduleWatchNotifications(new Date("2026-11-15T06:00:00Z"), [entry]);
    expect(result.scheduled).toBe(0);
    expect(await forOrg(A).notification.count({ where: { type: "watch.published" } })).toBe(2);
  });
});

describe("écran de veille", () => {
  it("les contrôles concernés sont reliés aux contrôles de l'organisation", async () => {
    const api = createCaller({
      headers: new Headers(),
      session: { userId: contributor, activeOrganizationId: A },
    });
    const feed = await api.watch.list();
    const ours = feed.find((e) => e.id === entry.id)!;
    expect(ours.title.fr).toBe("Entrée de test");
    expect(ours.controls).toEqual([
      {
        key: "AIA-05-01",
        instances: [
          expect.objectContaining({ controlId, systemId, systemName: "Score", status: "MISSING" }),
        ],
      },
      { key: "AIA-09-01", instances: [] },
    ]);
    expect(feed.some((e) => e.id === future.id)).toBe(false);
  });
});
