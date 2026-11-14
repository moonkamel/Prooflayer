// PL-505 — @prooflayer/verify. Les packs sont produits par le code de l'application (contenu, signature, archive,
// scellement) et vérifiés par l'implémentation indépendante du paquet : les deux doivent s'accorder. Puis chaque
// altération possible, y compris par quelqu'un qui détient la clé de signature, doit faire échouer la vérification.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as pkijs from "pkijs";
import { strToU8, unzipSync, zipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { zipPack } from "@/server/pack/archive";
import {
  buildPackFiles,
  type PackAnchor,
  type PackBatch,
  type PackEvidence,
  type PackInput,
} from "@/server/pack/contents";
import { packSigningKey, signManifest } from "@/server/pack/signing";
import { anchorHash, anchorHeader } from "@/server/seal/anchor";
import { batchHash, batchHeader, ZERO_HASH } from "@/server/seal/batch";
import { contentSha256, envelopeOf, evidenceLeafHash } from "@/server/seal/evidence";
import { createTestTsa, TEST_POLICY_OID, type TestTsa } from "../../../tests/helpers/test-tsa";
import { main, type CliIo } from "../src/cli";
import { summaryLine } from "../src/format";
import { PINNED_KEYS, PINNED_TSA_ROOTS } from "../src/trust";
import { verifyToken } from "../src/tsa";
import { verifyPack, type IssueCode, type VerifyOptions, type VerifyReport } from "../src/verify";

const ORG = "org_verify";
const key = packSigningKey({ BETTER_AUTH_SECRET: "secret-verify-test-0123456789" });
const sealedAt1 = new Date("2026-12-04T10:03:00.000Z");
const sealedAt2 = new Date("2027-03-03T09:03:00.000Z");
const genTime = new Date("2027-03-03T12:00:00.000Z");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let tsa: TestTsa;
let trust: VerifyOptions;

beforeAll(async () => {
  tsa = await createTestTsa();
  trust = {
    keys: { [key.kid]: key.publicKey.toString("base64") },
    tsaRoots: [{ name: "Prestataire de test", qualified: true, pem: tsa.rootPem }],
  };
});

function evidence(
  i: number,
  batchSeq: number,
  leafIndex: number,
  extra: Partial<PackEvidence> = {},
) {
  const payload = { number: i, title: `PR ${i}`, nested: { b: 2, a: [1, "é"] } };
  const salt = randomBytes(32);
  const base = {
    id: `ev_${i}`,
    kind: extra.kind ?? "github.pull_request.merged",
    sourceRef: `pr:${i}`,
    occurredAt: new Date(sealedAt1.getTime() - 3_600_000 + i),
    capturedAt: new Date(sealedAt1.getTime() - 1_800_000 + i),
    contentSha256: contentSha256(extra.payload ?? payload),
    attachmentSha256: extra.attachmentSha256 ?? null,
  };
  const leafHash = evidenceLeafHash(salt, envelopeOf({ orgId: ORG, ...base }));
  const item: PackEvidence = {
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
    batchSeq,
    leafIndex,
    ...extra,
  };
  return { item, leafHash };
}

interface Build {
  input: PackInput;
}

/**
 * Pack de référence : lot 1 (3 preuves dont une non divulguée), lot 2 (2 preuves, une pièce jointe, une effacée),
 * une ancre horodatée qui couvre les deux lots et un lot d'une autre organisation.
 */
async function reference(
  options: { anchorToken?: (digest: Uint8Array) => Promise<Uint8Array>; unanchored?: boolean } = {},
): Promise<Build> {
  const attachment = Buffer.from("%PDF-1.7 déclaration UE");
  const attachmentSha256 = createHash("sha256").update(attachment).digest();
  const e0 = evidence(0, 1, 0);
  const e1 = evidence(1, 1, 1);
  const hidden = evidence(2, 1, 2);
  const e3 = evidence(3, 2, 0, {
    kind: "manual.upload",
    declarative: true,
    attachment,
    attachmentMime: "application/pdf",
    attachmentSha256,
  });
  const erased = evidence(4, 2, 1);
  const leaves1 = [e0.leafHash, e1.leafHash, hidden.leafHash];
  const leaves2 = [e3.leafHash, erased.leafHash];
  const h1 = batchHeader({
    orgId: ORG,
    seq: 1,
    leafHashes: leaves1,
    prevBatchHash: ZERO_HASH,
    sealedAt: sealedAt1,
  });
  const bh1 = batchHash(h1);
  const h2 = batchHeader({
    orgId: ORG,
    seq: 2,
    leafHashes: leaves2,
    prevBatchHash: bh1,
    sealedAt: sealedAt2,
  });
  const bh2 = batchHash(h2);
  const foreign = createHash("sha256").update("lot d'une autre organisation").digest();
  const sorted = [bh1, bh2, foreign].sort(Buffer.compare);
  const ah = anchorHeader({ seq: 7, batchHashes: sorted, prevAnchorHash: randomBytes(32) });
  const hash = anchorHash(ah);
  const anchor: PackAnchor = {
    header: ah,
    anchorHash: hash,
    batchHashes: sorted,
    tsa: { name: tsa.name, policyOid: TEST_POLICY_OID, genTime },
    token: options.anchorToken ? await options.anchorToken(hash) : await tsa.token(hash, genTime),
  };
  const ref = (bh: Buffer) =>
    options.unanchored ? null : { seq: 7, leafIndex: sorted.findIndex((h) => h.equals(bh)) };
  const batches: PackBatch[] = [
    { header: h1, batchHash: bh1, leafHashes: leaves1, anchor: ref(bh1) },
    { header: h2, batchHash: bh2, leafHashes: leaves2, anchor: ref(bh2) },
  ];
  return {
    input: {
      packId: "pck_verify",
      generatedAt: new Date("2027-03-03T13:00:00.000Z"),
      language: "fr",
      organization: { id: ORG, name: "Talvio" },
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
          status: "PASS",
          notApplicable: false,
          justification: null,
          evidenceIds: ["ev_3"],
          lastEvaluation: null,
        },
      ],
      evidence: [e0.item, e1.item, e3.item, { ...erased.item, redactedAt: sealedAt2 }],
      batches,
      anchors: options.unanchored ? [] : [anchor],
      tsaRoots: { test: tsa.rootPem },
      report: Buffer.from("%PDF-1.4 rapport"),
      verifyMd: "# Vérifier",
    },
  };
}

/** Archive signée par ProofLayer (ou par la clé donnée), après retouche éventuelle des fichiers. */
function pack(
  input: PackInput,
  edit?: (files: Map<string, Uint8Array>, manifest: Record<string, unknown>) => void,
  signer = key,
): Uint8Array {
  const { files, manifest } = buildPackFiles(input);
  if (edit) {
    edit(files, manifest);
    manifest.files = [...files.entries()]
      .map(([path, bytes]) => ({ path, sha256: sha(bytes), size: bytes.length }))
      .sort((a, b) => (a.path < b.path ? -1 : 1));
  }
  return zipPack(files, signManifest(manifest, signer), input.generatedAt);
}

const json = (bytes: Uint8Array) => JSON.parse(Buffer.from(bytes).toString());
const bytesOf = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- documents JSON retouchés librement par les tests
function editJson(files: Map<string, Uint8Array>, path: string, change: (doc: any) => void) {
  const doc = json(files.get(path)!);
  change(doc);
  files.set(path, bytesOf(doc));
}

const codes = (report: VerifyReport) =>
  report.steps.flatMap((s) => s.issues.map((i) => i.code)).sort();
const expectFailure = (report: VerifyReport, code: IssueCode) => {
  expect(report.ok).toBe(false);
  expect(codes(report)).toContain(code);
};

describe("pack intact", () => {
  it("les six étapes passent ; recensement et phrase de synthèse du §4.6.3", async () => {
    const { input } = await reference();
    const report = await verifyPack(pack(input), trust);
    expect(codes(report)).toEqual([]);
    expect(report).toMatchObject({ ok: true, clean: true });
    expect(report.steps.map((s) => `${s.step}:${s.id}:${s.status}`)).toEqual([
      "1:signature:pass",
      "2:evidence:pass",
      "3:batches:pass",
      "4:anchors:pass",
      "5:timestamps:pass",
      "6:census:pass",
    ]);
    expect(report.summary).toMatchObject({
      verified: 3,
      declarative: 1,
      redacted: 1,
      leaves: 5,
      undisclosed: 2,
      batches: 2,
      anchors: 1,
      unanchoredBatches: 0,
      alterations: 0,
      sealedFrom: sealedAt1.toISOString(),
      sealedTo: sealedAt2.toISOString(),
      timestamps: [
        { anchor: 7, genTime: genTime.toISOString(), tsa: "Prestataire de test", qualified: true },
      ],
    });
    expect(report.pack).toMatchObject({ id: "pck_verify", signingKid: "pl-dev" });
    expect(summaryLine(report, "fr")).toBe(
      "3 preuves vérifiées, scellées entre le 4 décembre 2026 et le 3 mars 2027, 0 altération, 2 preuves de la période non divulguées",
    );
    expect(summaryLine(report, "en")).toBe(
      "3 evidence items verified, sealed between 4 December 2026 and 3 March 2027, 0 alterations, 2 evidence items from the period not disclosed",
    );
  });

  it("racine du prestataire jointe au pack : jamais crue (seules les racines épinglées comptent)", async () => {
    const { input } = await reference();
    const report = await verifyPack(pack(input), { ...trust, tsaRoots: PINNED_TSA_ROOTS });
    expectFailure(report, "token_untrusted");
  });

  it("prestataire non qualifié : avertissement, sans altération", async () => {
    const { input } = await reference();
    const report = await verifyPack(pack(input), {
      ...trust,
      tsaRoots: [{ name: "freetsa-like", qualified: false, pem: tsa.rootPem }],
    });
    expect(report).toMatchObject({ ok: true, clean: false });
    expect(codes(report)).toEqual(["tsa_not_qualified"]);
  });

  it("lots pas encore ancrés : avertissement, la date n'est attestée que par ProofLayer", async () => {
    const { input } = await reference({ unanchored: true });
    const report = await verifyPack(pack(input), trust);
    expect(report).toMatchObject({ ok: true, clean: false });
    expect(codes(report)).toEqual(["unanchored"]);
    expect(report.summary.unanchoredBatches).toBe(2);
  });

  it("jeton réel de freetsa.org vérifié contre la racine épinglée (non qualifiée)", async () => {
    const dir = join(process.cwd(), "tests/fixtures/tsa");
    const response = pkijs.TimeStampResp.fromBER(
      new Uint8Array(readFileSync(join(dir, "response.tsr"))).buffer,
    );
    const token = new Uint8Array(response.timeStampToken!.toSchema().toBER(false));
    const digest = new Uint8Array(readFileSync(join(dir, "digest.bin")));
    const check = await verifyToken(token, digest, PINNED_TSA_ROOTS);
    expect(check).toMatchObject({ ok: true, root: { name: "freetsa.org", qualified: false } });
    expect(await verifyToken(token, new Uint8Array(32), PINNED_TSA_ROOTS)).toEqual({
      ok: false,
      problem: "imprint",
    });
  });

  it("aucune clé de développement épinglée", () => {
    expect(Object.keys(PINNED_KEYS)).not.toContain("pl-dev");
    for (const [kid, value] of Object.entries(PINNED_KEYS)) {
      expect(kid).toMatch(/^pl-\d{4}-\d{2}$/u);
      expect(Buffer.from(value, "base64")).toHaveLength(32);
    }
  });
});

describe("altérations", () => {
  it("un octet changé après signature : empreinte du fichier et de la charge", async () => {
    const { input } = await reference();
    const files = unzipSync(pack(input));
    const doc = json(files["evidence/ev_1.json"]!);
    doc.payload.number = 99;
    files["evidence/ev_1.json"] = bytesOf(doc);
    const report = await verifyPack(zipSync(files), trust);
    expectFailure(report, "file_hash");
    expectFailure(report, "content_hash");
    expect(report.steps[0]!.status).toBe("fail");
  });

  it("charge modifiée puis manifeste re-signé avec la clé de ProofLayer : le scellement le révèle", async () => {
    const { input } = await reference();
    const zip = pack(input, (files) =>
      editJson(files, "evidence/ev_0.json", (doc) => {
        doc.payload.title = "PR approuvée";
        // Même en recalculant contentSha256, la feuille scellée ne correspond plus.
        doc.contentSha256 = contentSha256(doc.payload).toString("hex");
      }),
    );
    const report = await verifyPack(zip, trust);
    expect(report.steps[0]!.status).toBe("pass");
    expectFailure(report, "leaf_mismatch");
  });

  it("date de capture antidatée : la feuille ne correspond plus", async () => {
    const { input } = await reference();
    const zip = pack(input, (files) =>
      editJson(files, "evidence/ev_1.json", (doc) => {
        doc.capturedAt = "2026-01-01T00:00:00.000Z";
      }),
    );
    expectFailure(await verifyPack(zip, trust), "leaf_mismatch");
  });

  it("preuve retirée d'un lot : la racine de Merkle ne correspond plus", async () => {
    const { input } = await reference();
    const zip = pack(input, (files) =>
      editJson(files, "proofs/batches/1.json", (doc) => {
        doc.leafHashes.splice(2, 1);
        doc.header.leafCount = 2;
      }),
    );
    const report = await verifyPack(zip, trust);
    expectFailure(report, "merkle_root");
    expectFailure(report, "batch_hash");
  });

  it("lot recalculé de bout en bout sans une preuve : l'ancre et le jeton le révèlent", async () => {
    const { input } = await reference();
    const leaves = input.batches[0]!.leafHashes.slice(0, 2);
    const header = batchHeader({
      orgId: ORG,
      seq: 1,
      leafHashes: leaves,
      prevBatchHash: ZERO_HASH,
      sealedAt: sealedAt1,
    });
    input.batches[0] = {
      ...input.batches[0]!,
      header,
      batchHash: batchHash(header),
      leafHashes: leaves,
    };
    const report = await verifyPack(pack(input), trust);
    expectFailure(report, "anchor_leaf");
    expectFailure(report, "chain_prev");
  });

  it("chaîne de lots : trou ou prédécesseur différent", async () => {
    const { input } = await reference();
    const gap = pack(input, (files) => {
      files.set("proofs/batches/3.json", files.get("proofs/batches/2.json")!);
      files.delete("proofs/batches/2.json");
      editJson(files, "proofs/batches/3.json", (doc) => {
        doc.header.seq = 3;
      });
    });
    expectFailure(await verifyPack(gap, trust), "chain_gap");
    const first = pack(input, (files) =>
      editJson(files, "proofs/batches/1.json", (doc) => {
        doc.header.prevBatchHash = "11".repeat(32);
      }),
    );
    expectFailure(await verifyPack(first, trust), "chain_first");
  });

  it("ancre : feuilles non triées, racine ou empreinte différentes", async () => {
    const { input } = await reference();
    const zip = pack(input, (files) =>
      editJson(files, "proofs/anchors/7.json", (doc) => {
        doc.batchHashes.reverse();
      }),
    );
    const report = await verifyPack(zip, trust);
    expectFailure(report, "anchor_order");
    expectFailure(report, "anchor_root");
  });

  it("jeton d'une autre empreinte, d'un prestataire inconnu, d'un signataire sans usage d'horodatage", async () => {
    const other = await reference({
      anchorToken: () => tsa.token(new Uint8Array(32).fill(1), genTime),
    });
    expectFailure(await verifyPack(pack(other.input), trust), "token_imprint");
    const stranger = await createTestTsa();
    const unknown = await reference({ anchorToken: (d) => stranger.token(d, genTime) });
    expectFailure(await verifyPack(pack(unknown.input), trust), "token_untrusted");
    const noUsage = await createTestTsa({ timestamping: false });
    const usage = await reference({ anchorToken: (d) => noUsage.token(d, genTime) });
    expectFailure(
      await verifyPack(pack(usage.input), {
        ...trust,
        tsaRoots: [{ name: "x", qualified: true, pem: noUsage.rootPem }],
      }),
      "token_usage",
    );
  });

  it("jeton antérieur au scellement d'un lot, ou date déclarée différente du jeton", async () => {
    const early = await reference({
      anchorToken: (d) => tsa.token(d, new Date("2027-01-01T00:00:00Z")),
    });
    const report = await verifyPack(pack(early.input), trust);
    expectFailure(report, "sealed_after_token");
    expectFailure(report, "token_time");
  });

  it("jeton absent ou illisible", async () => {
    const { input } = await reference();
    const missing = pack(input, (files) => files.delete("proofs/anchors/7.tst"));
    expectFailure(await verifyPack(missing, trust), "token_missing");
    const garbled = pack(input, (files) => files.set("proofs/anchors/7.tst", new Uint8Array(40)));
    expectFailure(await verifyPack(garbled, trust), "token_malformed");
  });

  it("pièce jointe remplacée, puis retirée", async () => {
    const { input } = await reference();
    const replaced = pack(input, (files) =>
      files.set("evidence/ev_3.pdf", strToU8("%PDF-1.7 autre")),
    );
    expectFailure(await verifyPack(replaced, trust), "attachment_hash");
    const removed = pack(input, (files) => files.delete("evidence/ev_3.pdf"));
    expectFailure(await verifyPack(removed, trust), "attachment_missing");
  });

  it("fichier ajouté hors manifeste ; fichier listé supprimé", async () => {
    const { input } = await reference();
    const files = unzipSync(pack(input));
    files["evidence/ev_9.json"] = strToU8("{}");
    expectFailure(await verifyPack(zipSync(files), trust), "file_unlisted");
    delete files["evidence/ev_9.json"];
    delete files["controls.json"];
    expectFailure(await verifyPack(zipSync(files), trust), "file_missing");
  });

  it("recensement annoncé faux, preuve citée par un contrôle et absente", async () => {
    const { input } = await reference();
    const zip = pack(input, (files, manifest) => {
      (manifest.counts as Record<string, number>).undisclosed = 0;
      files.delete("evidence/ev_1.json");
    });
    const report = await verifyPack(zip, trust);
    expectFailure(report, "count_mismatch");
    expectFailure(report, "control_evidence");
  });

  it("signature : clé inconnue, clé d'un tiers, champ du manifeste modifié", async () => {
    const { input } = await reference();
    expectFailure(await verifyPack(pack(input), { ...trust, keys: {} }), "unknown_key");
    const attacker = packSigningKey({ BETTER_AUTH_SECRET: "un-autre-secret-0123456789" });
    expectFailure(await verifyPack(pack(input, undefined, attacker), trust), "bad_signature");
    const files = unzipSync(pack(input));
    const manifest = json(files["manifest.json"]!);
    manifest.period.start = "2027-01-01";
    files["manifest.json"] = bytesOf(manifest);
    expectFailure(await verifyPack(zipSync(files), trust), "bad_signature");
  });

  it("archive illisible : échec sans exception", async () => {
    const report = await verifyPack(new Uint8Array([1, 2, 3]), trust);
    expect(report.ok).toBe(false);
    expect(report.steps.map((s) => s.status)).toEqual([
      "fail",
      "skipped",
      "skipped",
      "skipped",
      "skipped",
      "skipped",
    ]);
  });

  it("au plus 50 anomalies détaillées par étape, puis le décompte", async () => {
    const { input } = await reference();
    const zip = pack(input, (files) => {
      for (let i = 0; i < 60; i++) files.set(`proofs/batches/${100 + i}.json`, strToU8("{}"));
    });
    const report = await verifyPack(zip, trust);
    const batches = report.steps[2]!;
    expect(batches.issues).toHaveLength(50);
    expect(batches.issueCount).toBe(60);
  });
});

describe("ligne de commande", () => {
  async function run(args: string[], files: Record<string, Uint8Array> = {}) {
    let stdout = "";
    let stderr = "";
    const io: CliIo = {
      readFile: async (path) => {
        const bytes = files[path];
        if (!bytes) throw new Error("ENOENT");
        return bytes;
      },
      stdout: (t) => (stdout += t),
      stderr: (t) => (stderr += t),
      envLang: "fr_FR.UTF-8",
    };
    const code = await main(args, io);
    return { code, stdout, stderr };
  }
  const trustArgs = () => [
    "--trust-key",
    `${key.kid}=${key.publicKey.toString("base64")}`,
    "--trust-tsa",
    "root.pem",
  ];

  it("pack intact : code 0, sortie lisible dans la langue du pack", async () => {
    const { input } = await reference();
    const files = { "pack.zip": pack(input), "root.pem": strToU8(tsa.rootPem) };
    const out = await run(["pack.zip", ...trustArgs()], files);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("✓ 1. Signature du manifeste et intégrité des fichiers : vérifié");
    expect(out.stdout).toContain("! 5. Horodatage RFC 3161 : avertissement");
    expect(out.stdout).toContain(
      "3 preuves vérifiées, scellées entre le 4 décembre 2026 et le 3 mars 2027",
    );
    expect(out.stdout).toContain("Résultat : aucune altération, avec des avertissements.");
    // La racine passée à la main n'est jamais réputée qualifiée : --strict échoue.
    expect((await run(["pack.zip", "--strict", ...trustArgs()], files)).code).toBe(1);
    const en = await run(["pack.zip", "--lang", "en", ...trustArgs()], files);
    expect(en.stdout).toContain("Result: no alteration, with warnings.");
  });

  it("sortie JSON ; pack altéré : code 1", async () => {
    const { input } = await reference();
    const zip = unzipSync(pack(input));
    zip["report.pdf"] = strToU8("%PDF-1.4 autre rapport");
    const files = { "pack.zip": zipSync(zip), "root.pem": strToU8(tsa.rootPem) };
    const out = await run(["pack.zip", "--json", ...trustArgs()], files);
    expect(out.code).toBe(1);
    const report = JSON.parse(out.stdout);
    expect(report).toMatchObject({ ok: false, passed: false, version: "0.1.0" });
    expect(report.steps[0].issues[0]).toMatchObject({
      code: "file_hash",
      params: { path: "report.pdf" },
    });
  });

  it("sans clé de ProofLayer épinglée pour ce pack : code 1", async () => {
    const { input } = await reference();
    const out = await run(["pack.zip"], { "pack.zip": pack(input) });
    expect(out.code).toBe(1);
    expect(out.stdout).toContain("Clé de signature « pl-dev » inconnue de l'outil");
  });

  it("aide, version, fichier illisible, option inconnue", async () => {
    expect((await run(["--help"])).code).toBe(0);
    expect((await run(["--version"])).stdout).toBe("0.1.0\n");
    const missing = await run(["absent.zip"]);
    expect(missing).toMatchObject({ code: 1, stderr: "Impossible de lire absent.zip.\n" });
    const unknown = await run(["--bogus"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("Erreur : --bogus");
    expect((await run([])).code).toBe(1);
  });
});
