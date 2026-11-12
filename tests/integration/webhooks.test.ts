// PL-302 — Réception des webhooks GitHub sur base réelle : signature invalide → 401 ; dix rejeux → une seule ligne ;
// 202 en moins de 500 ms ; traitement jusqu'à la preuve ; livraisons ignorées ; réessai planifié ; reprise par le cron.
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKey, masterKeyFromEnv } from "@/server/crypto/envelope";
import { forOrg, prisma } from "@/server/db";
import { drainDeliveries, handleDelivery, processDelivery } from "@/server/ingest/process-delivery";
import type { ObjectStore } from "@/server/storage/object-store";
import { claimDeliveries } from "@/server/system/webhooks";

const SECRET = "secret-de-test-webhook";
const run = randomUUID().slice(0, 8);
const A = `org_whk_${run}`;
const INSTALLATION = Number(`5${run.replace(/\D/gu, "").slice(0, 6).padEnd(6, "1")}`);
let objects: string;
let POST: (req: Request) => Promise<Response>;

const fixture = (name: string) => {
  const f = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "github", name), "utf8"));
  f.installation = { id: INSTALLATION };
  return f;
};
const delivery = () => `dlv-${run}-${randomUUID().slice(0, 8)}`;

function request(body: unknown, opts: { id?: string; event?: string; signature?: string } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  return new Request("http://localhost/api/webhooks/github", {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-github-delivery": opts.id ?? delivery(),
      "x-github-event": opts.event ?? "pull_request",
      "x-hub-signature-256":
        opts.signature ?? "sha256=" + createHmac("sha256", SECRET).update(raw).digest("hex"),
    },
  });
}

async function statusOf(deliveryId: string) {
  return (await prisma.webhookDelivery.findFirst({ where: { deliveryId } }))?.status;
}

/** Le traitement lancé par waitUntil peut tourner en parallèle : on attend qu'il soit terminé. */
async function settled(deliveryId: string) {
  await processDelivery("GITHUB", deliveryId);
  for (let i = 0; i < 50; i++) {
    const status = await statusOf(deliveryId);
    if (status !== "PENDING" && status !== "PROCESSING") return status;
    await new Promise((r) => setTimeout(r, 100));
  }
  return statusOf(deliveryId);
}

beforeAll(async () => {
  objects = await mkdtemp(join(tmpdir(), "pl-whk-"));
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  process.env.PROOFLAYER_MASTER_KEY = generateKey().toString("base64");
  process.env.OBJECT_STORE_DIR = objects;
  ({ POST } = await import("@/app/api/webhooks/github/route"));
  await prisma.organization.create({ data: { id: A, name: A, slug: A } });
  const db = forOrg(A);
  const integration = await db.integration.create({
    data: {
      orgId: A,
      provider: "GITHUB",
      externalAccountId: String(INSTALLATION),
      externalAccountName: "talvio-demo",
      createdByUserId: "usr_test",
    },
  });
  await db.integrationResource.create({
    data: {
      orgId: A,
      integrationId: integration.id,
      kind: "github_repo",
      externalId: "701234567",
      name: "talvio-demo/scoring-model",
      config: { defaultBranch: "main" },
    },
  });
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "WebhookDelivery" WHERE "deliveryId" LIKE $1`, [
      `dlv-${run}-%`,
    ]);
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

describe("réception", () => {
  it("signature invalide → 401, sans enregistrement ; en-têtes manquants → 400", async () => {
    const id = delivery();
    expect(
      (await POST(request(fixture("pull_request/merged-1.json"), { id, signature: "sha256=00" })))
        .status,
    ).toBe(401);
    expect((await POST(request({}, { signature: "" }))).status).toBe(401);
    expect(await prisma.webhookDelivery.count({ where: { deliveryId: id } })).toBe(0);
    const missing = new Request("http://localhost/api/webhooks/github", {
      method: "POST",
      body: "{}",
    });
    expect((await POST(missing)).status).toBe(400);
  });

  it("dix rejeux → une seule ligne, chaque réponse 202 en moins de 500 ms", async () => {
    const id = delivery();
    const body = fixture("pull_request/merged-1.json");
    for (let i = 0; i < 10; i++) {
      const started = performance.now();
      const response = await POST(request(body, { id }));
      expect(response.status).toBe(202);
      expect(performance.now() - started).toBeLessThan(500);
    }
    expect(await prisma.webhookDelivery.count({ where: { deliveryId: id } })).toBe(1);
    expect(await settled(id)).toBe("PROCESSED");
  });

  it("sans secret configuré, le webhook est refusé (503), jamais accepté sans contrôle", async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    try {
      expect((await POST(request({}))).status).toBe(503);
    } finally {
      process.env.GITHUB_WEBHOOK_SECRET = SECRET;
    }
  });
});

describe("traitement", () => {
  it("PR fusionnée sur un dépôt lié → preuve minimisée, charge brute chiffrée, livraison PROCESSED", async () => {
    const id = delivery();
    const body = fixture("pull_request/merged-1.json");
    body.pull_request.number = 9001;
    await POST(request(body, { id }));
    expect(await settled(id)).toBe("PROCESSED");
    const evidence = await forOrg(A).evidenceItem.findFirstOrThrow({
      where: { dedupeKey: "gh:pr:701234567:9001:merged" },
    });
    expect(evidence).toMatchObject({ kind: "github.pull_request.merged", capturedVia: "WEBHOOK" });
    expect(evidence.resourceId).not.toBeNull();
    expect(evidence.rawObjectKey).toMatch(/^orgs\/.+\/raw\/ev_/u);
    expect(JSON.stringify(evidence.payload)).not.toContain("Contexte confidentiel");
    const integration = await forOrg(A).integration.findFirstOrThrow({});
    expect(integration.lastEventAt).not.toBeNull();
  });

  it("ignore une installation inconnue, un dépôt non lié et un événement non suivi", async () => {
    const unknown = fixture("pull_request/merged-2.json");
    unknown.installation = { id: 1 };
    const unlinked = fixture("pull_request/merged-2.json");
    const untracked = { ...fixture("pull_request/merged-1.json"), action: "opened" };
    for (const body of [unknown, unlinked, untracked]) {
      const id = delivery();
      await POST(request(body, { id }));
      expect(await settled(id)).toBe("IGNORED");
    }
  });

  it("un échec planifie un nouvel essai, sans la charge dans le message ; le cron reprend", async () => {
    const id = delivery();
    const body = fixture("release/published-1.json");
    // Livraison enregistrée sans traitement immédiat : on la prend nous-mêmes.
    const raw = Buffer.from(JSON.stringify(body));
    const { recordDelivery } = await import("@/server/system/webhooks");
    await recordDelivery({
      provider: "GITHUB",
      deliveryId: id,
      eventType: "release",
      externalAccountId: String(INSTALLATION),
      payload: body,
      rawBody: raw,
    });
    const [claimed] = await claimDeliveries(1, { provider: "GITHUB", deliveryId: id });
    const broken: ObjectStore = {
      put: async () => {
        throw new Error("stockage indisponible");
      },
      get: async () => null,
      delete: async () => {},
      presignPut: async () => "",
    };
    expect(await handleDelivery(claimed!, { store: broken, master: masterKeyFromEnv() })).toBe(
      "retry",
    );
    const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { deliveryId: id } });
    expect(row).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(row.lastError).toBe("Error: stockage indisponible");
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);

    // Arrivée à échéance, la livraison est reprise par le cron.
    await prisma.webhookDelivery.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(0) },
    });
    const stats = await drainDeliveries();
    expect(stats.processed).toBeGreaterThanOrEqual(1);
    expect(await statusOf(id)).toBe("PROCESSED");
    expect(
      await forOrg(A).evidenceItem.count({ where: { kind: "github.release.published" } }),
    ).toBe(1);
  });
});
