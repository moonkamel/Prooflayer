// PL-206 — Publication de la bibliothèque de contrôles : idempotente, sous le rôle de migration ; le rôle applicatif
// lit le référentiel sans pouvoir l'écrire ; un contrôle modifié est signalé, un contrôle retiré est marqué, pas supprimé.
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { CONTROL_LIBRARY, LIBRARY_VERSION } from "@/server/rules/library";
import { syncControlLibrary } from "@/server/system/control-library";

const migration = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_DATABASE_URL }),
});
const testVersion = `test-${randomUUID().slice(0, 8)}`;

afterAll(async () => {
  await migration.controlDefinition.deleteMany({ where: { libraryVersion: testVersion } });
  await migration.$disconnect();
  await prisma.$disconnect();
});

describe("synchronisation de la bibliothèque", () => {
  it("publie les 37 contrôles, puis ne change plus rien", async () => {
    await syncControlLibrary(migration);
    const again = await syncControlLibrary(migration);
    expect(again).toEqual({
      libraryVersion: LIBRARY_VERSION,
      created: [],
      updated: [],
      deprecated: [],
      unchanged: 37,
    });
    const rows = await prisma.controlDefinition.findMany({
      where: { libraryVersion: LIBRARY_VERSION, deprecatedAt: null },
    });
    expect(rows).toHaveLength(37);
    expect(rows.filter((r) => r.automation === "AUTOMATED")).toHaveLength(19);
    const peerReview = rows.find((r) => r.key === "AIA-15-02");
    expect(peerReview).toMatchObject({
      articleRef: "Art. 15(1), 17(1)(b)",
      pack: "B",
      evaluatorKey: "github.peerReview",
      params: { windowDays: 90, minApprovals: 1 },
      appliesToRoles: ["PROVIDER"],
      appliesToTiers: ["HIGH_RISK"],
    });
    expect(peerReview?.title).toHaveProperty("en");
  });

  it("signale un contrôle modifié et marque un contrôle retiré, sans le supprimer", async () => {
    const [first, second] = CONTROL_LIBRARY as [
      (typeof CONTROL_LIBRARY)[0],
      (typeof CONTROL_LIBRARY)[0],
    ];
    const created = await syncControlLibrary(migration, [first, second], testVersion);
    expect(created.created).toEqual([first.key, second.key]);

    const changed = { ...first, freshnessDays: 30 };
    const report = await syncControlLibrary(migration, [changed], testVersion);
    expect(report).toMatchObject({
      created: [],
      updated: [first.key],
      deprecated: [second.key],
      unchanged: 0,
    });
    const rows = await prisma.controlDefinition.findMany({
      where: { libraryVersion: testVersion },
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.key === first.key)?.freshnessDays).toBe(30);
    expect(rows.find((r) => r.key === second.key)?.deprecatedAt).not.toBeNull();

    // Un contrôle réintroduit redevient actif.
    const restored = await syncControlLibrary(migration, [changed, second], testVersion);
    expect(restored).toMatchObject({ updated: [second.key], deprecated: [], unchanged: 1 });
  });

  it("le rôle applicatif lit le référentiel mais ne peut pas l'écrire", async () => {
    expect(
      await prisma.controlDefinition.count({ where: { libraryVersion: LIBRARY_VERSION } }),
    ).toBe(37);
    const error = await syncControlLibrary(prisma, CONTROL_LIBRARY, `${testVersion}-app`).then(
      () => "",
      (e: Error) => e.message,
    );
    expect(error).toMatch(/permission denied|denied/iu);
    expect(
      await prisma.controlDefinition.count({ where: { libraryVersion: `${testVersion}-app` } }),
    ).toBe(0);
  });
});
