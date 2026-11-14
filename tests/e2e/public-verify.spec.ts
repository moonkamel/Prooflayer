// PL-508 — Page publique de vérification : un pack déposé est vérifié dans le navigateur, sans compte et sans qu'aucune
// requête ne transporte le fichier ; résultat en clair et détail des six étapes ; un octet modifié fait échouer la
// vérification ; écrans sans violation WCAG 2.2 AA. Le pack est produit par le code de l'application, signé par une clé
// de test publiée en base comme le serait une clé de production.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync, zipSync } from "fflate";
import pg from "pg";
import { zipPack } from "../../src/server/pack/archive";
import { buildPackFiles } from "../../src/server/pack/contents";
import { rawPublicKey, signManifest } from "../../src/server/pack/signing";
import { batchHash, batchHeader, ZERO_HASH } from "../../src/server/seal/batch";
import { contentSha256, envelopeOf, evidenceLeafHash } from "../../src/server/seal/evidence";
import { expectNoViolations } from "./helpers/a11y";

const KID = "pl-2099-01";
const { privateKey } = generateKeyPairSync("ed25519");
const key = { kid: KID, privateKey, publicKey: rawPublicKey(privateKey) };

function samplePack(): Uint8Array {
  const now = new Date("2026-11-10T10:00:00.000Z");
  const evidence = [0, 1, 2].map((i) => {
    const payload = { number: i };
    const salt = randomBytes(32);
    const base = {
      id: `ev_e2e_${i}`,
      kind: "github.pull_request.merged",
      sourceRef: `pr:${i}`,
      occurredAt: now,
      capturedAt: new Date(now.getTime() + i),
      contentSha256: contentSha256(payload),
      attachmentSha256: null,
    };
    return {
      leaf: evidenceLeafHash(salt, envelopeOf({ orgId: "org_e2e", ...base })),
      item: {
        ...base,
        source: "GITHUB",
        capturedVia: "WEBHOOK",
        sourceUrl: null,
        summary: `PR #${i}`,
        declarative: false,
        validUntil: null,
        redactedAt: null,
        payload,
        salt,
        attachmentMime: null,
        attachment: null,
        batchSeq: 1,
        leafIndex: i,
      },
    };
  });
  const leaves = evidence.map((e) => e.leaf);
  const header = batchHeader({
    orgId: "org_e2e",
    seq: 1,
    leafHashes: leaves,
    prevBatchHash: ZERO_HASH,
    sealedAt: now,
  });
  const { files, manifest } = buildPackFiles({
    packId: "pck_e2e",
    generatedAt: now,
    language: "fr",
    organization: { id: "org_e2e", name: "Talvio" },
    system: { id: "sys_e2e", name: "Score" },
    period: { start: "2026-11-01", end: "2026-11-10" },
    libraryVersion: "2026.11.0",
    controls: [],
    // Deux preuves divulguées sur trois : la troisième n'est que comptée.
    evidence: evidence.slice(0, 2).map((e) => e.item),
    batches: [{ header, batchHash: batchHash(header), leafHashes: leaves, anchor: null }],
    anchors: [],
    tsaRoots: {},
    report: new Uint8Array(Buffer.from("%PDF-1.4 rapport")),
    verifyMd: "# Vérifier",
  });
  return zipPack(files, signManifest(manifest, key), now);
}

async function publishTestKey(remove = false) {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    if (remove) await client.query(`DELETE FROM "SigningKey" WHERE kid = $1`, [KID]);
    else {
      await client.query(
        `INSERT INTO "SigningKey" (kid, "publicKey") VALUES ($1, $2)
         ON CONFLICT (kid) DO UPDATE SET "publicKey" = EXCLUDED."publicKey"`,
        [KID, key.publicKey],
      );
    }
  } finally {
    await client.end();
  }
}

async function drop(page: Page, name: string, bytes: Uint8Array) {
  await page.getByLabel("Pack d'audit (.zip)").setInputFiles({
    name,
    mimeType: "application/zip",
    buffer: Buffer.from(bytes),
  });
}

test.beforeAll(() => publishTestKey());
test.afterAll(() => publishTestKey(true));

test("pack intact vérifié dans le navigateur, sans envoi du fichier ; un octet modifié échoue", async ({
  page,
}) => {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") sent.push(`${request.method()} ${request.url()}`);
  });
  await page.goto("/verify");
  await expect(
    page.getByRole("heading", { level: 1, name: "Vérifier un pack d'audit" }),
  ).toBeVisible();
  await expect(page.getByText("Le fichier ne quitte pas votre poste")).toBeVisible();
  await expectNoViolations(page, "/verify");

  const zip = samplePack();
  await drop(page, "pack-score.zip", zip);
  const result = page.getByTestId("verify-result");
  await expect(result).toHaveAttribute("data-verdict", "okWithWarnings");
  await expect(
    page.getByRole("heading", { name: "Aucune altération, avec des points d'attention" }),
  ).toBeVisible();
  await expect(page.getByTestId("verify-summary")).toContainText(
    "2 preuves vérifiées, scellées le 10 novembre 2026, 0 altération, 1 preuve de la période non divulguée",
  );
  await expect(page.getByTestId("verify-step")).toHaveCount(6);
  await expect(page.getByTestId("verify-step").first()).toHaveAttribute("data-status", "pass");
  // Lot pas encore horodaté par un tiers : point d'attention, sans altération.
  await expect(page.getByTestId("verify-step").nth(3)).toHaveAttribute("data-status", "warning");
  await expect(page.getByText("Manifeste signé par la clé pl-2099-01.")).toBeVisible();
  await expectNoViolations(page, "/verify (résultat)");
  expect(sent).toEqual([]);

  // Une preuve modifiée après signature.
  await page.getByRole("button", { name: "Vérifier un autre pack" }).click();
  const files = unzipSync(zip);
  const doc = JSON.parse(Buffer.from(files["evidence/ev_e2e_1.json"]!).toString());
  doc.payload.number = 42;
  files["evidence/ev_e2e_1.json"] = new Uint8Array(Buffer.from(JSON.stringify(doc)));
  await drop(page, "pack-altere.zip", zipSync(files));
  await expect(result).toHaveAttribute("data-verdict", "fail");
  await expect(page.getByRole("heading", { name: "Échec de la vérification" })).toBeVisible();
  await expect(page.getByTestId("verify-step").first()).toContainText(
    "Empreinte différente du manifeste : evidence/ev_e2e_1.json.",
  );
  await expectNoViolations(page, "/verify (échec)");

  // Fichier qui n'est pas une archive.
  await page.getByRole("button", { name: "Vérifier un autre pack" }).click();
  await drop(page, "notes.txt", new Uint8Array(Buffer.from("texte")));
  await expect(page.getByText("Ce fichier n'est pas une archive .zip.")).toHaveAttribute(
    "role",
    "alert",
  );
  expect(sent).toEqual([]);
});
