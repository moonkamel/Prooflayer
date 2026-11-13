// PL-504 — Pack d'audit, fonctions pures : signature Ed25519 du manifeste (JCS sans le champ signature), clé de
// production obligatoire, clé de développement dérivée ; contenu de l'archive (empreinte de chaque fichier, feuilles
// non divulguées comptées, preuve effacée sans charge ni sel, pièce jointe jointe) ; archive ZIP relue à l'identique.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { unzipPack, zipPack } from "@/server/pack/archive";
import { buildPackFiles, type PackEvidence, type PackInput } from "@/server/pack/contents";
import {
  DEV_KID,
  packSigningKey,
  signManifest,
  SigningKeyNotConfiguredError,
  verifyManifestSignature,
} from "@/server/pack/signing";
import { batchHash, batchHeader, ZERO_HASH } from "@/server/seal/batch";
import { contentSha256, envelopeOf, evidenceLeafHash } from "@/server/seal/evidence";
import { createHash } from "node:crypto";

const now = new Date("2027-03-03T10:00:00.000Z");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("signature du manifeste", () => {
  const key = packSigningKey({ BETTER_AUTH_SECRET: "secret-de-test-0123456789" });
  const keys = new Map([[key.kid, key.publicKey]]);

  it("hors production : clé de développement dérivée, stable, identifiant pl-dev", () => {
    expect(key.kid).toBe(DEV_KID);
    expect(key.publicKey).toHaveLength(32);
    expect(
      packSigningKey({ BETTER_AUTH_SECRET: "secret-de-test-0123456789" }).publicKey.equals(
        key.publicKey,
      ),
    ).toBe(true);
  });

  it("production : clé et identifiant obligatoires, Ed25519 seulement", () => {
    expect(() => packSigningKey({ VERCEL_ENV: "production" })).toThrow(
      SigningKeyNotConfiguredError,
    );
    const { privateKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    expect(() => packSigningKey({ VERCEL_ENV: "production", PACK_SIGNING_KEY: pem })).toThrow(
      SigningKeyNotConfiguredError,
    );
    const prod = packSigningKey({
      VERCEL_ENV: "production",
      PACK_SIGNING_KEY: pem,
      PACK_SIGNING_KID: "pl-2026-11",
    });
    expect(prod.kid).toBe("pl-2026-11");
    const der = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    expect(
      packSigningKey({ PACK_SIGNING_KEY: der, PACK_SIGNING_KID: "pl-2026-11" }).publicKey.equals(
        prod.publicKey,
      ),
    ).toBe(true);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
      format: "pem",
      type: "pkcs8",
    });
    expect(() =>
      packSigningKey({ PACK_SIGNING_KEY: rsa.toString(), PACK_SIGNING_KID: "pl-2026-11" }),
    ).toThrow(SigningKeyNotConfiguredError);
  });

  it("signature vérifiée ; tout champ modifié, une autre clé ou un identifiant inconnu : refus", () => {
    const manifest = { v: 1, packId: "pck_1", files: [{ path: "report.pdf", sha256: "ab" }] };
    const signed = signManifest(manifest, key);
    expect(signed.signature).toMatchObject({ alg: "Ed25519", kid: DEV_KID });
    expect(verifyManifestSignature(signed, keys)).toBe(true);
    // L'ordre des clés n'entre pas dans la signature (JCS).
    expect(
      verifyManifestSignature(
        { files: signed.files, signature: signed.signature, packId: "pck_1", v: 1 },
        keys,
      ),
    ).toBe(true);
    expect(verifyManifestSignature({ ...signed, packId: "pck_2" }, keys)).toBe(false);
    expect(
      verifyManifestSignature({ ...signed, files: [{ path: "report.pdf", sha256: "ac" }] }, keys),
    ).toBe(false);
    const other = packSigningKey({ BETTER_AUTH_SECRET: "autre-secret-0123456789" });
    expect(verifyManifestSignature(signed, new Map([[DEV_KID, other.publicKey]]))).toBe(false);
    expect(
      verifyManifestSignature(
        { ...signed, signature: { ...signed.signature, kid: "pl-2020-01" } },
        keys,
      ),
    ).toBe(false);
    expect(verifyManifestSignature({ ...signed, signature: undefined }, keys)).toBe(false);
  });
});

function evidence(
  i: number,
  extra: Partial<PackEvidence> = {},
): PackEvidence & { leafHash: Buffer } {
  const payload = { number: i };
  const salt = randomBytes(32);
  const base = {
    id: `ev_${i}`,
    kind: "github.pull_request.merged",
    sourceRef: `pr:${i}`,
    occurredAt: now,
    capturedAt: new Date(now.getTime() + i),
    contentSha256: contentSha256(payload),
    attachmentSha256: null,
  };
  const leafHash = evidenceLeafHash(salt, envelopeOf({ orgId: "org_1", ...base }));
  return {
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
    leafHash,
    ...extra,
  };
}

describe("contenu du pack", () => {
  const items = [0, 1, 2].map((i) => evidence(i));
  const hidden = evidence(3);
  const leaves = [...items.map((e) => e.leafHash), hidden.leafHash];
  const header = batchHeader({
    orgId: "org_1",
    seq: 1,
    leafHashes: leaves,
    prevBatchHash: ZERO_HASH,
    sealedAt: now,
  });
  const attachment = Buffer.from("%PDF-1.7 déclaration");
  const input = (): PackInput => ({
    packId: "pck_1",
    generatedAt: now,
    language: "fr",
    organization: { id: "org_1", name: "Talvio" },
    system: { id: "sys_1", name: "Score" },
    period: { start: "2026-12-04", end: "2027-03-03" },
    libraryVersion: "2026.11.0",
    controls: [
      {
        key: "AIA-15-02",
        articleRef: "Art. 15(1)",
        title: { fr: "PR approuvées", en: "PRs approved" },
        automation: "AUTOMATED",
        status: "FAIL",
        notApplicable: false,
        justification: null,
        evidenceIds: ["ev_0", "ev_1"],
        lastEvaluation: null,
      },
      {
        key: "AIA-47-01",
        articleRef: "Art. 47",
        title: { fr: "Déclaration UE", en: "EU declaration" },
        automation: "MANUAL",
        status: "MISSING",
        notApplicable: false,
        justification: null,
        evidenceIds: [],
        lastEvaluation: null,
      },
    ],
    evidence: [
      ...items.slice(0, 2),
      {
        ...items[2]!,
        attachmentMime: "application/pdf",
        attachment,
        attachmentSha256: createHash("sha256").update(attachment).digest(),
      },
      evidence(4, { redactedAt: now }),
    ],
    batches: [{ header, batchHash: batchHash(header), leafHashes: leaves, anchor: null }],
    anchors: [],
    tsaRoots: {},
    report: Buffer.from("%PDF-1.4 rapport"),
    verifyMd: "# Vérifier",
  });

  it("chaque fichier figure au manifeste avec son empreinte ; décomptes et feuilles non divulguées", () => {
    const { files, manifest } = buildPackFiles(input());
    expect([...files.keys()].sort()).toEqual(
      [
        "VERIFY.md",
        "controls.json",
        "evidence/ev_0.json",
        "evidence/ev_1.json",
        "evidence/ev_2.json",
        "evidence/ev_2.pdf",
        "evidence/ev_4.json",
        "proofs/batches/1.json",
        "report.pdf",
      ].sort(),
    );
    for (const f of manifest.files) expect(f.sha256).toBe(sha(files.get(f.path)!));
    expect(manifest.counts).toMatchObject({
      controls: 2,
      failing: 1,
      missing: 1,
      disclosed: 3,
      leaves: 4,
      undisclosed: 1,
      batches: 1,
      unanchoredBatches: 1,
    });
    const batch = JSON.parse(Buffer.from(files.get("proofs/batches/1.json")!).toString());
    expect(batch.leafHashes).toContain(hidden.leafHash.toString("hex"));
  });

  it("preuve divulguée : charge, sel et enveloppe permettent de recalculer sa feuille ; effacée : ni charge ni sel", () => {
    const { files } = buildPackFiles(input());
    const doc = JSON.parse(Buffer.from(files.get("evidence/ev_1.json")!).toString());
    const leaf = evidenceLeafHash(
      Buffer.from(doc.salt, "hex"),
      envelopeOf({
        orgId: "org_1",
        id: doc.id,
        kind: doc.kind,
        sourceRef: doc.sourceRef,
        occurredAt: new Date(doc.occurredAt),
        capturedAt: new Date(doc.capturedAt),
        contentSha256: contentSha256(doc.payload),
        attachmentSha256: null,
      }),
    );
    expect(leaf.equals(items[1]!.leafHash)).toBe(true);
    expect(doc.seal).toEqual({ batch: 1, leafIndex: 1 });
    const erased = JSON.parse(Buffer.from(files.get("evidence/ev_4.json")!).toString());
    expect(erased).toMatchObject({ redacted: true, payload: null, salt: null });
    const withFile = JSON.parse(Buffer.from(files.get("evidence/ev_2.json")!).toString());
    expect(withFile.attachment).toEqual({ path: "evidence/ev_2.pdf", mime: "application/pdf" });
    expect(sha(files.get("evidence/ev_2.pdf")!)).toBe(withFile.attachmentSha256);
  });

  it("archive ZIP relue à l'identique, manifeste signé en tête", () => {
    const { files, manifest } = buildPackFiles(input());
    const key = packSigningKey({ BETTER_AUTH_SECRET: "secret-de-test-0123456789" });
    const zip = zipPack(files, signManifest(manifest, key), now);
    const read = unzipPack(zip);
    expect([...read.keys()][0]).toBe("manifest.json");
    for (const [path, bytes] of files)
      expect(Buffer.from(read.get(path)!).equals(Buffer.from(bytes))).toBe(true);
    const signed = JSON.parse(Buffer.from(read.get("manifest.json")!).toString());
    expect(verifyManifestSignature(signed, new Map([[key.kid, key.publicKey]]))).toBe(true);
  });
});
