// PL-610 — Design partners sur base réelle : ouverture du pilote (12 semaines d'essai aux limites Growth, abonnement
// payant jamais modifié), session, pack transmis, relevé des quatre métriques, suppression avec l'organisation.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma } from "@/server/db";
import {
  addPartner,
  partnersReport,
  recordPackShared,
  recordSession,
} from "@/server/system/design-partners";

const run = randomUUID().slice(0, 8);
const A = `org_dp_a_${run}`;
const B = `org_dp_b_${run}`;
const start = new Date("2026-11-02T09:00:00Z");

beforeAll(async () => {
  for (const id of [A, B])
    await prisma.organization.create({ data: { id, name: `Partenaire ${id}`, slug: id } });
  await forOrg(A).subscription.create({
    data: {
      orgId: A,
      plan: "TRIAL",
      status: "trialing",
      monitoredSystemsLimit: 1,
      trialEndsAt: new Date(),
    },
  });
  await forOrg(B).subscription.create({
    data: {
      orgId: B,
      plan: "GROWTH",
      status: "active",
      stripeSubscriptionId: `sub_dp_${run}`,
      monitoredSystemsLimit: 5,
    },
  });
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    for (const id of [A, B]) await client.query("SELECT purge_organization($1)", [id]);
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("pilote", () => {
  it("ouverture : essai porté à 12 semaines aux limites Growth ; un abonnement payant reste intact", async () => {
    expect((await addPartner(A, "hr_tech", start)).trialEndsAt).toEqual(
      new Date("2027-01-25T09:00:00Z"),
    );
    expect(await forOrg(A).subscription.findUniqueOrThrow({ where: { orgId: A } })).toMatchObject({
      plan: "TRIAL",
      monitoredSystemsLimit: 5,
      trialEndsAt: new Date("2027-01-25T09:00:00Z"),
    });
    await addPartner(B, "fintech", start);
    expect(await forOrg(B).subscription.findUniqueOrThrow({ where: { orgId: B } })).toMatchObject({
      plan: "GROWTH",
      status: "active",
      trialEndsAt: null,
    });
    await expect(addPartner(`org_inconnue_${run}`, "fintech")).rejects.toThrow(
      "Organisation inconnue",
    );
  });

  it("relevé : session, pack transmis, conversion, remplacement dû sans GitHub", async () => {
    await recordSession(A, new Date("2026-11-03T10:00:00Z"));
    await recordPackShared(B, "auditor", new Date("2026-11-10T10:00:00Z"));
    const report = await partnersReport(new Date("2026-11-20T09:00:00Z"));
    const mine = report.partners.filter((p) => [A, B].includes(p.orgId));
    expect(mine).toEqual([
      expect.objectContaining({
        orgId: A,
        sessionDone: true,
        replaceDue: true,
        metrics: expect.objectContaining({ packShared: null, paying: false }),
      }),
      expect.objectContaining({
        orgId: B,
        sessionDone: false,
        metrics: expect.objectContaining({ packShared: "auditor", paying: true }),
      }),
    ]);
  });

  it("supprimé avec l'organisation", async () => {
    const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
    await client.connect();
    try {
      await client.query("SELECT purge_organization($1)", [A]);
    } finally {
      await client.end();
    }
    expect(await prisma.designPartner.findUnique({ where: { orgId: A } })).toBeNull();
  });
});
