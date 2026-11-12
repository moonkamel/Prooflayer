// PL-405 — Preuves manuelles et attestations sur base réelle : dépôt direct par adresse signée (stockage local),
// contrôle du type, de la taille et du contenu, empreinte scellée, fichier chiffré, zone d'arrivée effacée ;
// attestation confirmée par mot de passe ; contrôle évalué (PASS), puis périmé à expiration (STALE).
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKey } from "@/server/crypto/envelope";
import { forOrg, prisma, withOrgTransaction } from "@/server/db";
import { LIBRARY_VERSION } from "@/server/rules/library";
import { evaluateInstance } from "@/server/services/evaluation";
import {
  attest,
  createUploadUrl,
  registerUpload,
  type ManualEvidenceDependencies,
} from "@/server/services/manual-evidence";
import type { OrgContext } from "@/server/services/organization";
import { LocalObjectStore } from "@/server/storage/object-store";
import { acceptLocalUpload } from "@/server/system/local-upload";
import { jobRegistry } from "@/server/system/jobs/handlers";
import { runJobNow } from "@/server/system/jobs/queue";

const run = randomUUID().slice(0, 8);
const A = `org_manual_${run}`;
const owner = `usr_manual_${run}`;
const other = `usr_manual_other_${run}`;
const SECRET = "secret-depot-0123456789-0123456789";
let dir = "";
let deps: ManualEvidenceDependencies;
const instances: Record<string, string> = {};
const ctx = (userId = owner): OrgContext => ({
  headers: new Headers(),
  orgId: A,
  userId,
  role: "owner",
  db: forOrg(A),
});
const accept = { verifyPassword: async (p: string) => p === "bon-mot-de-passe" };
const tomorrowPlus = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Dépôt par le navigateur sur l'adresse signée locale, comme le ferait le formulaire. */
async function put(url: string, contentType: string, body: Buffer) {
  const token = new URL(url, "http://localhost").searchParams.get("t");
  return acceptLocalUpload(token, contentType, new Uint8Array(body), {
    OBJECT_STORE: "local",
    OBJECT_STORE_DIR: dir,
    BETTER_AUTH_SECRET: SECRET,
  });
}

async function drainOrg() {
  for (let round = 0; round < 5; round++) {
    const queued = await prisma.job.findMany({ where: { orgId: A, status: "QUEUED" } });
    if (queued.length === 0) return;
    for (const job of queued) await runJobNow(job.id, jobRegistry);
  }
}
const statusOf = async (key: string) =>
  (await forOrg(A).controlInstance.findUniqueOrThrow({ where: { id: instances[key]! } })).status;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pl-manual-"));
  process.env.PROOFLAYER_MASTER_KEY ??= generateKey().toString("base64");
  deps = { store: new LocalObjectStore(dir, SECRET), secret: SECRET, now: () => new Date() };
  await prisma.organization.create({ data: { id: A, name: A, slug: A } });
  for (const id of [owner, other]) {
    await prisma.user.create({ data: { id, email: `${id}@manual.test`, name: id } });
  }
  const system = await forOrg(A).aiSystem.create({
    data: {
      orgId: A,
      name: "Score",
      slug: `score-${run}`,
      intendedPurpose: "Test",
      ownerUserId: owner,
      models: [],
    },
  });
  const definitions = await prisma.controlDefinition.findMany({
    where: { key: { in: ["AIA-05-01", "AIA-47-01"] }, libraryVersion: LIBRARY_VERSION },
  });
  for (const d of definitions) {
    instances[d.key] = (
      await forOrg(A).controlInstance.create({
        data: { orgId: A, systemId: system.id, definitionId: d.id },
      })
    ).id;
  }
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "Job" WHERE "orgId" = $1`, [A]);
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [A]);
    await client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "EvidenceItem" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "OrgEncryptionKey" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "Organization" WHERE id = $1`, [A]);
    await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[owner, other]]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("dépôt d'un document", () => {
  const pdf = Buffer.from("%PDF-1.7\nDéclaration UE de conformité signée\n%%EOF");

  it("refus avant dépôt : type non accepté, trop volumineux, contrôle inconnu", async () => {
    const base = {
      controlInstanceIds: [instances["AIA-47-01"]!],
      filename: "x.pdf",
      contentType: "application/pdf",
      size: 10,
    };
    await expect(createUploadUrl(ctx(), { ...base, filename: "x.exe" }, deps)).rejects.toThrow(
      "evidence.unsupportedType",
    );
    await expect(createUploadUrl(ctx(), { ...base, size: 26 * 1024 * 1024 }, deps)).rejects.toThrow(
      "evidence.tooLarge",
    );
    await expect(
      createUploadUrl(ctx(), { ...base, controlInstanceIds: ["cin_inconnue"] }, deps),
    ).rejects.toThrow("control.notFound");
  });

  it("adresse signée, dépôt, enregistrement : empreinte scellée, fichier chiffré, zone d'arrivée effacée, contrôle PASS", async () => {
    const { uploadUrl, token } = await createUploadUrl(
      ctx(),
      {
        controlInstanceIds: [instances["AIA-47-01"]!],
        filename: "declaration-ue.pdf",
        contentType: "application/pdf",
        size: pdf.length,
      },
      deps,
    );
    expect(await put(uploadUrl, "text/plain", pdf)).toBe(403);
    expect(await put(uploadUrl, "application/pdf", pdf)).toBe(200);
    // Le jeton d'un autre utilisateur, ou une date de validité passée, sont refusés.
    await expect(
      registerUpload(ctx(other), { token, validUntil: tomorrowPlus(30) }, deps),
    ).rejects.toThrow("evidence.invalidUpload");
    await expect(registerUpload(ctx(), { token, validUntil: "2020-01-01" }, deps)).rejects.toThrow(
      "evidence.invalidValidity",
    );
    const { evidenceId, sha256 } = await registerUpload(
      ctx(),
      { token, validUntil: tomorrowPlus(365), title: "Déclaration UE de conformité" },
      deps,
    );
    expect(sha256).toBe(createHash("sha256").update(pdf).digest("hex"));
    const evidence = await forOrg(A).evidenceItem.findUniqueOrThrow({ where: { id: evidenceId } });
    expect(evidence).toMatchObject({
      kind: "manual.upload",
      source: "MANUAL",
      capturedVia: "UPLOAD",
      declarative: true,
      attachmentMime: "application/pdf",
      createdByUserId: owner,
    });
    expect(Buffer.from(evidence.attachmentSha256!).toString("hex")).toBe(sha256);
    expect(evidence.validUntil).not.toBeNull();
    // Fichier chiffré : le clair n'apparaît pas dans l'objet stocké ; plus rien dans la zone d'arrivée.
    const stored = await readFile(join(dir, evidence.attachmentKey!));
    expect(stored.includes(Buffer.from("Déclaration UE"))).toBe(false);
    expect(await readdir(join(dir, "orgs", A, "incoming")).catch(() => [])).toEqual([]);
    const link = await forOrg(A).evidenceLink.findFirstOrThrow({ where: { evidenceId } });
    expect(link).toMatchObject({ controlInstanceId: instances["AIA-47-01"], linkedBy: owner });
    const entry = await forOrg(A).auditLog.findFirstOrThrow({
      where: { action: "evidence.upload" },
    });
    expect(entry.metadata).toMatchObject({ sha256, filename: "declaration-ue.pdf" });
    await drainOrg();
    expect(await statusOf("AIA-47-01")).toBe("PASS");
    // Le même jeton ne sert qu'une fois.
    await expect(
      registerUpload(ctx(), { token, validUntil: tomorrowPlus(30) }, deps),
    ).rejects.toThrow("evidence.uploadMissing");
  });

  it("contenu qui ne correspond pas au type annoncé : refusé et effacé", async () => {
    const { uploadUrl, token } = await createUploadUrl(
      ctx(),
      {
        controlInstanceIds: [instances["AIA-47-01"]!],
        filename: "faux.pdf",
        contentType: "application/pdf",
        size: 5,
      },
      deps,
    );
    expect(await put(uploadUrl, "application/pdf", Buffer.from("<html>"))).toBe(200);
    await expect(
      registerUpload(ctx(), { token, validUntil: tomorrowPlus(30) }, deps),
    ).rejects.toThrow("evidence.contentMismatch");
    expect(await readdir(join(dir, "orgs", A, "incoming")).catch(() => [])).toEqual([]);
  });
});

describe("attestation", () => {
  const input = () => ({
    controlInstanceIds: [instances["AIA-05-01"]!],
    statement:
      "J'atteste qu'aucune pratique interdite par l'Art. 5 n'a été identifiée lors de la revue annuelle.",
    name: "Clara Martin",
    title: "CTO",
    validUntil: tomorrowPlus(365),
    password: "bon-mot-de-passe",
  });

  it("mot de passe refusé : rien n'est créé, le refus est journalisé", async () => {
    await expect(attest(ctx(), { ...input(), password: "mauvais" }, accept)).rejects.toThrow(
      "classification.invalidPassword",
    );
    expect(await forOrg(A).evidenceItem.count({ where: { kind: "manual.attestation" } })).toBe(0);
    expect(await forOrg(A).auditLog.count({ where: { action: "evidence.attestRefused" } })).toBe(1);
  });

  it("signée : preuve déclarative nommée, contrôle PASS, puis STALE à expiration", async () => {
    const { evidenceId } = await attest(ctx(), input(), accept);
    const evidence = await forOrg(A).evidenceItem.findUniqueOrThrow({ where: { id: evidenceId } });
    expect(evidence).toMatchObject({
      kind: "manual.attestation",
      capturedVia: "ATTESTATION",
      declarative: true,
    });
    expect(evidence.payload).toMatchObject({ signerName: "Clara Martin", signerTitle: "CTO" });
    await drainOrg();
    expect(await statusOf("AIA-05-01")).toBe("PASS");
    const later = new Date(evidence.validUntil!.getTime() + 86_400_000);
    const outcome = await withOrgTransaction(A, (tx) =>
      evaluateInstance(tx, A, instances["AIA-05-01"]!, later),
    );
    expect(outcome).toMatchObject({ evaluated: true, status: "STALE" });
  });
});
