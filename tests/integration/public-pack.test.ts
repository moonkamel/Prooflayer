// PL-606 — Pack d'audit public de ProofLayer, sur base réelle : seul le pack désigné en configuration et prêt est
// servi ; un pack en cours, un pack d'une autre organisation ou une configuration absente ne divulguent rien.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma } from "@/server/db";
import { packObjectKey } from "@/server/services/packs";
import {
  publicPackArchive,
  publicPackConfig,
  publicPackSummary,
} from "@/server/services/public-pack";
import type { ObjectStore } from "@/server/storage/object-store";
import { prunePublicLeads } from "@/server/system/public-leads";

const run = randomUUID().slice(0, 8);
const A = `org_pubpack_${run}`;
const B = `org_pubpack_b_${run}`;
const owner = `usr_pubpack_${run}`;
const files = new Map<string, Buffer>();
const store = {
  get: async (key: string) => files.get(key) ?? null,
} as unknown as ObjectStore;
let ready = "";
let queued = "";
let other = "";

async function pack(orgId: string, status: "READY" | "QUEUED") {
  const system = await forOrg(orgId).aiSystem.create({
    data: {
      orgId,
      name: "ProofLayer",
      slug: `prooflayer-${randomUUID().slice(0, 6)}`,
      intendedPurpose: "Preuves",
      ownerUserId: owner,
      models: [],
    },
  });
  const created = await forOrg(orgId).auditPack.create({
    data: {
      orgId,
      systemId: system.id,
      requestedByUserId: "usr_x",
      periodStart: new Date("2026-08-01T00:00:00Z"),
      periodEnd: new Date("2026-10-31T00:00:00Z"),
      status,
      evidenceCount: 42,
      signingKid: "pl-2026-11",
      manifestSha256: Buffer.alloc(32, 7),
    },
  });
  const objectKey = packObjectKey(orgId, created.id);
  if (status === "READY") {
    await forOrg(orgId).auditPack.update({ where: { id: created.id }, data: { objectKey } });
    files.set(objectKey, Buffer.from(`zip:${created.id}`));
  }
  return created.id;
}

beforeAll(async () => {
  await prisma.user.create({ data: { id: owner, email: `${owner}@pubpack.test`, name: "Owner" } });
  for (const id of [A, B]) await prisma.organization.create({ data: { id, name: id, slug: id } });
  ready = await pack(A, "READY");
  queued = await pack(A, "QUEUED");
  other = await pack(B, "READY");
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const id of [A, B]) {
      await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [id]);
      await client.query(`DELETE FROM "AiSystem" WHERE "orgId" = $1`, [id]);
      await client.query(`DELETE FROM "Organization" WHERE id = $1`, [id]);
    }
    await client.query(`DELETE FROM "User" WHERE id = $1`, [owner]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("pack public", () => {
  it("configuration absente ou partielle : rien n'est publié", async () => {
    expect(publicPackConfig({})).toBeNull();
    expect(publicPackConfig({ PUBLIC_PACK_ORG_ID: A })).toBeNull();
    expect(await publicPackSummary(null)).toBeNull();
    expect(await publicPackArchive(null, store)).toBeNull();
  });

  it("pack prêt : résumé et archive", async () => {
    const config = { orgId: A, packId: ready };
    expect(await publicPackSummary(config)).toMatchObject({
      systemName: "ProofLayer",
      evidenceCount: 42,
      signingKid: "pl-2026-11",
      manifestSha256: "07".repeat(32),
    });
    const archive = await publicPackArchive(config, store);
    expect(archive?.bytes.toString()).toBe(`zip:${ready}`);
    expect(archive?.filename).toMatch(/^prooflayer-pack-prooflayer-/u);
  });

  it("pack en cours, ou désigné sous une autre organisation : rien", async () => {
    expect(await publicPackSummary({ orgId: A, packId: queued })).toBeNull();
    expect(await publicPackArchive({ orgId: A, packId: other }, store)).toBeNull();
    expect(await publicPackSummary({ orgId: B, packId: ready })).toBeNull();
  });
});

describe("conservation des demandes du classifieur public (politique de confidentialité)", () => {
  it("sans accord : 30 jours ; avec accord : trois ans", async () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const day = 86_400_000;
    const lead = (consent: boolean, ageDays: number) =>
      prisma.publicLead.create({
        data: {
          email: `${randomUUID().slice(0, 6)}@lead-${run}.test`,
          emailDomain: `lead-${run}.test`,
          contactConsent: consent,
          locale: "fr",
          responses: {},
          rulesetVersion: "test",
          tier: "MINIMAL",
          role: "DEPLOYER",
          ipHash: "x",
          createdAt: new Date(now.getTime() - ageDays * day),
        },
        select: { id: true },
      });
    const kept = [await lead(false, 29), await lead(true, 31), await lead(true, 3 * 365 - 1)];
    await lead(false, 31);
    await lead(true, 3 * 365 + 1);
    await prunePublicLeads(now);
    const left = await prisma.publicLead.findMany({
      where: { emailDomain: `lead-${run}.test` },
      select: { id: true },
    });
    expect(left.map((l) => l.id).sort()).toEqual(kept.map((l) => l.id).sort());
    await prisma.publicLead.deleteMany({ where: { emailDomain: `lead-${run}.test` } });
  });
});
