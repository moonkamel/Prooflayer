// Vérification d'un pack d'audit ProofLayer, hors ligne (§4.6.3). Six étapes :
//   1. signature Ed25519 du manifeste (clé épinglée) et empreinte de chaque fichier ;
//   2. recalcul de contentSha256 et de leafHash de chaque preuve divulguée, à sa place dans son lot ;
//   3. racine de chaque lot, batchHash, continuité de la chaîne de lots ;
//   4. inclusion de chaque batchHash dans son ancre, anchorHash ;
//   5. jeton RFC 3161 de chaque ancre : empreinte, signature, racine de confiance épinglée, date ;
//   6. recensement : feuilles de la période, preuves divulguées, écart.
// Aucune dépendance aux serveurs de ProofLayer : seuls le pack, les clés et les racines épinglées comptent.
import { unzipSync } from "fflate";
import {
  canonicalize,
  equalBytes,
  fromBase64,
  fromHex,
  headerHash,
  leafHash,
  merkleRoot,
  sha256,
  toHex,
  utf8,
  verifyEd25519,
} from "./crypto.js";
import { PINNED_KEYS, PINNED_TSA_ROOTS } from "./trust.js";
import { verifyToken, type TrustedRoot } from "./tsa.js";

export const STEPS = [
  "signature",
  "evidence",
  "batches",
  "anchors",
  "timestamps",
  "census",
] as const;
export type StepId = (typeof STEPS)[number];

export const ISSUE_CODES = [
  // 1. Signature et fichiers
  "manifest_missing",
  "manifest_invalid",
  "unknown_key",
  "bad_signature",
  "file_missing",
  "file_hash",
  "file_unlisted",
  // 2. Preuves
  "evidence_invalid",
  "content_hash",
  "attachment_hash",
  "attachment_missing",
  "attachment_withheld",
  "leaf_mismatch",
  "leaf_duplicate",
  "batch_missing",
  "leaf_index",
  // 3. Lots
  "batch_invalid",
  "batch_org",
  "leaf_count",
  "merkle_root",
  "batch_hash",
  "chain_gap",
  "chain_prev",
  "chain_first",
  // 4. Ancres
  "anchor_invalid",
  "anchor_missing",
  "anchor_order",
  "anchor_count",
  "anchor_root",
  "anchor_hash",
  "anchor_leaf",
  "anchor_chain",
  "unanchored",
  // 5. Horodatage
  "token_missing",
  "token_malformed",
  "token_imprint",
  "token_signature",
  "token_untrusted",
  "token_usage",
  "token_time",
  "token_policy",
  "sealed_after_token",
  "tsa_not_qualified",
  // 6. Recensement
  "count_mismatch",
  "control_evidence",
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

export interface Issue {
  code: IssueCode;
  severity: "error" | "warning";
  params: Record<string, string | number>;
}

export interface StepResult {
  step: number;
  id: StepId;
  status: "pass" | "warning" | "fail" | "skipped";
  /** Au plus `MAX_ISSUES_PER_STEP` ; le total est dans `issueCount`. */
  issues: Issue[];
  issueCount: number;
}

export interface VerifyReport {
  /** Aucune altération (code de sortie 0). */
  ok: boolean;
  /** Ni altération ni avertissement (option --strict). */
  clean: boolean;
  pack: {
    id: string;
    organization: { id: string; name: string };
    system: { id: string; name: string };
    period: { start: string; end: string };
    generatedAt: string;
    language: string;
    signingKid: string | null;
  } | null;
  steps: StepResult[];
  summary: {
    /** Preuves divulguées dont l'empreinte et la feuille ont été recalculées. */
    verified: number;
    declarative: number;
    redacted: number;
    leaves: number;
    undisclosed: number;
    batches: number;
    anchors: number;
    unanchoredBatches: number;
    /** Nombre total d'erreurs. */
    alterations: number;
    warnings: number;
    sealedFrom: string | null;
    sealedTo: string | null;
    timestamps: { anchor: number; genTime: string; tsa: string; qualified: boolean }[];
  };
}

export interface VerifyOptions {
  /** Clés publiques Ed25519 (32 octets, base64 ou octets), par identifiant. Par défaut : celles épinglées. */
  keys?: Readonly<Record<string, string | Uint8Array>>;
  /** Racines des prestataires d'horodatage. Par défaut : celles épinglées. */
  tsaRoots?: readonly TrustedRoot[];
}

export const MAX_ISSUES_PER_STEP = 50;
const ENVELOPE_VERSION = 1;
const ZERO = new Uint8Array(32);
/** Écart toléré entre la date déclarée d'une ancre et celle du jeton (arrondi de stockage). */
const GEN_TIME_TOLERANCE_MS = 1_000;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const hash32 = (v: unknown) => {
  const bytes = fromHex(v);
  return bytes && bytes.length === 32 ? bytes : null;
};

class Step {
  readonly issues: Issue[] = [];
  count = 0;
  skipped = false;
  constructor(
    readonly step: number,
    readonly id: StepId,
  ) {}
  error(code: IssueCode, params: Issue["params"] = {}) {
    this.add({ code, severity: "error", params });
  }
  warn(code: IssueCode, params: Issue["params"] = {}) {
    this.add({ code, severity: "warning", params });
  }
  private add(issue: Issue) {
    this.count++;
    if (this.issues.length < MAX_ISSUES_PER_STEP) this.issues.push(issue);
    if (issue.severity === "error") this.errors++;
    else this.warnings++;
  }
  errors = 0;
  warnings = 0;
  result(): StepResult {
    return {
      step: this.step,
      id: this.id,
      status: this.skipped
        ? "skipped"
        : this.errors > 0
          ? "fail"
          : this.warnings > 0
            ? "warning"
            : "pass",
      issues: this.issues,
      issueCount: this.count,
    };
  }
}

const parseJson = (bytes: Uint8Array | undefined): unknown => {
  if (!bytes) return undefined;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
};

interface Batch {
  seq: number;
  header: Json;
  sealedAt: Date;
  prevBatchHash: Uint8Array;
  /** batchHash recalculé. */
  hash: Uint8Array;
  leaves: Uint8Array[];
  anchor: { seq: number; leafIndex: number } | null;
}

interface Anchor {
  seq: number;
  header: Json;
  prevAnchorHash: Uint8Array;
  /** anchorHash recalculé. */
  hash: Uint8Array;
  batchHashes: Uint8Array[];
  declared: { name: string; policyOid: string; genTime: Date | null };
}

function keyBytes(value: string | Uint8Array): Uint8Array | null {
  return typeof value === "string" ? fromBase64(value) : value;
}

export async function verifyPack(
  zip: Uint8Array,
  options: VerifyOptions = {},
): Promise<VerifyReport> {
  const keys = options.keys ?? PINNED_KEYS;
  const roots = options.tsaRoots ?? PINNED_TSA_ROOTS;
  const steps = STEPS.map((id, i) => new Step(i + 1, id));
  const [s1, s2, s3, s4, s5, s6] = steps as [Step, Step, Step, Step, Step, Step];
  const summary: VerifyReport["summary"] = {
    verified: 0,
    declarative: 0,
    redacted: 0,
    leaves: 0,
    undisclosed: 0,
    batches: 0,
    anchors: 0,
    unanchoredBatches: 0,
    alterations: 0,
    warnings: 0,
    sealedFrom: null,
    sealedTo: null,
    timestamps: [],
  };
  const finish = (pack: VerifyReport["pack"]): VerifyReport => {
    summary.alterations = steps.reduce((n, s) => n + s.errors, 0);
    summary.warnings = steps.reduce((n, s) => n + s.warnings, 0);
    return {
      ok: summary.alterations === 0,
      clean: summary.alterations === 0 && summary.warnings === 0,
      pack,
      steps: steps.map((s) => s.result()),
      summary,
    };
  };

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    s1.error("manifest_missing");
    for (const s of steps.slice(1)) s.skipped = true;
    return finish(null);
  }

  // ── 1. Manifeste : signature et empreinte de chaque fichier ──────────────────────────────────────────────────────
  const manifest = parseJson(files["manifest.json"]);
  if (!isObject(manifest)) {
    s1.error(files["manifest.json"] ? "manifest_invalid" : "manifest_missing");
    for (const s of steps.slice(1)) s.skipped = true;
    return finish(null);
  }
  const org = isObject(manifest.organization) ? manifest.organization : {};
  const system = isObject(manifest.system) ? manifest.system : {};
  const period = isObject(manifest.period) ? manifest.period : {};
  const signature = isObject(manifest.signature) ? manifest.signature : null;
  const orgId = typeof org.id === "string" ? org.id : "";
  const pack: NonNullable<VerifyReport["pack"]> = {
    id: String(manifest.packId ?? ""),
    organization: { id: orgId, name: String(org.name ?? "") },
    system: { id: String(system.id ?? ""), name: String(system.name ?? "") },
    period: { start: String(period.start ?? ""), end: String(period.end ?? "") },
    generatedAt: String(manifest.generatedAt ?? ""),
    language: String(manifest.language ?? ""),
    signingKid: typeof signature?.kid === "string" ? signature.kid : null,
  };
  if (manifest.type !== "prooflayer.pack" || manifest.v !== 1 || !orgId) {
    s1.error("manifest_invalid");
  }

  if (!signature || signature.alg !== "Ed25519" || typeof signature.value !== "string") {
    s1.error("bad_signature", { kid: pack.signingKid ?? "" });
  } else {
    const raw = pack.signingKid ? keys[pack.signingKid] : undefined;
    const key = raw ? keyBytes(raw) : null;
    if (!key) {
      s1.error("unknown_key", { kid: pack.signingKid ?? "" });
    } else {
      const { signature: _omitted, ...unsigned } = manifest;
      void _omitted;
      const sig = fromBase64(signature.value);
      const valid = sig !== null && (await verifyEd25519(key, sig, utf8(canonicalize(unsigned))));
      if (!valid) s1.error("bad_signature", { kid: pack.signingKid ?? "" });
    }
  }

  const listed = new Set<string>();
  const entries = Array.isArray(manifest.files) ? manifest.files : [];
  if (!Array.isArray(manifest.files)) s1.error("manifest_invalid");
  for (const entry of entries) {
    if (!isObject(entry) || typeof entry.path !== "string") {
      s1.error("manifest_invalid");
      continue;
    }
    listed.add(entry.path);
    const bytes = files[entry.path];
    if (!bytes) {
      s1.error("file_missing", { path: entry.path });
      continue;
    }
    const expected = hash32(entry.sha256);
    if (!expected || !equalBytes(await sha256(bytes), expected)) {
      s1.error("file_hash", { path: entry.path });
    }
  }
  for (const path of Object.keys(files).sort()) {
    // Un répertoire de l'archive n'est pas un fichier.
    if (path === "manifest.json" || path.endsWith("/")) continue;
    if (!listed.has(path)) s1.error("file_unlisted", { path });
  }

  // ── 3. Lots (lus avant les preuves, qui y renvoient) ─────────────────────────────────────────────────────────────
  const batches = new Map<number, Batch>();
  for (const path of Object.keys(files).sort()) {
    const match = /^proofs\/batches\/(\d+)\.json$/u.exec(path);
    if (!match) continue;
    const seq = Number(match[1]);
    const doc = parseJson(files[path]);
    const header = isObject(doc) && isObject(doc.header) ? doc.header : null;
    const leafList = isObject(doc) && Array.isArray(doc.leafHashes) ? doc.leafHashes : null;
    const leaves = leafList?.map(hash32) ?? [];
    const prev = header ? hash32(header.prevBatchHash) : null;
    const root = header ? hash32(header.merkleRoot) : null;
    const sealedAt =
      header && typeof header.sealedAt === "string" ? new Date(header.sealedAt) : null;
    const anchorRef = isObject(doc) ? doc.anchor : undefined;
    const anchor =
      isObject(anchorRef) && isInt(anchorRef.seq) && isInt(anchorRef.leafIndex)
        ? { seq: anchorRef.seq, leafIndex: anchorRef.leafIndex }
        : null;
    if (
      !header ||
      header.seq !== seq ||
      !leafList ||
      leafList.length === 0 ||
      leaves.some((l) => l === null) ||
      !prev ||
      !root ||
      !sealedAt ||
      Number.isNaN(sealedAt.getTime()) ||
      (anchorRef !== null && !anchor)
    ) {
      s3.error("batch_invalid", { seq });
      continue;
    }
    const batch: Batch = {
      seq,
      header,
      sealedAt,
      prevBatchHash: prev,
      hash: await headerHash(header),
      leaves: leaves as Uint8Array[],
      anchor,
    };
    batches.set(seq, batch);
    if (header.org !== orgId) s3.error("batch_org", { seq });
    if (header.leafCount !== batch.leaves.length) s3.error("leaf_count", { seq });
    if (!equalBytes(await merkleRoot(batch.leaves), root)) s3.error("merkle_root", { seq });
    const declared = isObject(doc) ? hash32(doc.batchHash) : null;
    if (!declared || !equalBytes(declared, batch.hash)) s3.error("batch_hash", { seq });
  }
  const ordered = [...batches.values()].sort((a, b) => a.seq - b.seq);
  for (const [i, batch] of ordered.entries()) {
    const previous = ordered[i - 1];
    if (batch.seq === 1 && !equalBytes(batch.prevBatchHash, ZERO)) {
      s3.error("chain_first", { seq: batch.seq });
    }
    if (!previous) continue;
    if (batch.seq !== previous.seq + 1) s3.error("chain_gap", { seq: batch.seq });
    else if (!equalBytes(batch.prevBatchHash, previous.hash)) {
      s3.error("chain_prev", { seq: batch.seq });
    }
  }

  // ── 2. Preuves divulguées ────────────────────────────────────────────────────────────────────────────────────────
  const evidenceIds = new Set<string>();
  const usedLeaves = new Set<string>();
  for (const path of Object.keys(files).sort()) {
    const match = /^evidence\/([^/]+)\.json$/u.exec(path);
    if (!match) continue;
    const doc = parseJson(files[path]);
    const seal = isObject(doc) && isObject(doc.seal) ? doc.seal : null;
    if (
      !isObject(doc) ||
      doc.id !== match[1] ||
      typeof doc.kind !== "string" ||
      typeof doc.sourceRef !== "string" ||
      typeof doc.occurredAt !== "string" ||
      typeof doc.capturedAt !== "string" ||
      typeof doc.redacted !== "boolean" ||
      !hash32(doc.contentSha256) ||
      (doc.attachmentSha256 !== null && !hash32(doc.attachmentSha256)) ||
      !seal ||
      !isInt(seal.batch) ||
      !isInt(seal.leafIndex)
    ) {
      s2.error("evidence_invalid", { path });
      continue;
    }
    const id = doc.id as string;
    evidenceIds.add(id);
    const batch = batches.get(seal.batch);
    if (!batch) {
      s2.error("batch_missing", { id, batch: seal.batch });
      continue;
    }
    const leaf = batch.leaves[seal.leafIndex];
    if (!leaf) {
      s2.error("leaf_index", { id, batch: seal.batch });
      continue;
    }
    const position = `${seal.batch}:${seal.leafIndex}`;
    if (usedLeaves.has(position)) s2.error("leaf_duplicate", { id, batch: seal.batch });
    usedLeaves.add(position);
    if (doc.redacted) {
      // Effacée (droit à l'effacement) : ni charge ni sel, seule sa feuille demeure dans le lot (§4.6.5).
      summary.redacted++;
      continue;
    }
    const salt = hash32(doc.salt);
    if (!salt) {
      s2.error("evidence_invalid", { path });
      continue;
    }
    let content: Uint8Array;
    try {
      content = await sha256(utf8(canonicalize(doc.payload ?? null)));
    } catch {
      s2.error("evidence_invalid", { path });
      continue;
    }
    let ok = true;
    if (!equalBytes(content, hash32(doc.contentSha256)!)) {
      s2.error("content_hash", { id });
      ok = false;
    }
    const attachmentSha = doc.attachmentSha256 === null ? null : hash32(doc.attachmentSha256);
    const attachment = isObject(doc.attachment) ? doc.attachment : null;
    if (attachment && typeof attachment.path === "string") {
      const bytes = files[attachment.path];
      if (!attachmentSha) {
        s2.error("attachment_hash", { id });
        ok = false;
      } else if (!bytes) {
        s2.error("attachment_missing", { id });
        ok = false;
      } else if (!equalBytes(await sha256(bytes), attachmentSha)) {
        s2.error("attachment_hash", { id });
        ok = false;
      }
    } else if (attachmentSha) {
      // L'empreinte est scellée mais le fichier n'est pas joint : la preuve reste vérifiable, pas son document.
      s2.warn("attachment_withheld", { id });
    }
    const envelope = {
      v: ENVELOPE_VERSION,
      org: orgId,
      id,
      kind: doc.kind,
      sourceRef: doc.sourceRef,
      occurredAt: doc.occurredAt,
      capturedAt: doc.capturedAt,
      contentSha256: doc.contentSha256,
      attachmentSha256: doc.attachmentSha256,
    };
    if (!equalBytes(await leafHash(salt, envelope), leaf)) {
      s2.error("leaf_mismatch", { id, batch: seal.batch });
      ok = false;
    }
    if (ok) {
      summary.verified++;
      if (doc.declarative === true) summary.declarative++;
    }
  }

  // ── 4. Ancres ────────────────────────────────────────────────────────────────────────────────────────────────────
  const anchors = new Map<number, Anchor>();
  for (const path of Object.keys(files).sort()) {
    const match = /^proofs\/anchors\/(\d+)\.json$/u.exec(path);
    if (!match) continue;
    const seq = Number(match[1]);
    const doc = parseJson(files[path]);
    const header = isObject(doc) && isObject(doc.header) ? doc.header : null;
    const list = isObject(doc) && Array.isArray(doc.batchHashes) ? doc.batchHashes : null;
    const hashes = list?.map(hash32) ?? [];
    const prev = header ? hash32(header.prevAnchorHash) : null;
    const root = header ? hash32(header.merkleRoot) : null;
    const tsa = isObject(doc) && isObject(doc.tsa) ? doc.tsa : {};
    if (
      !header ||
      header.seq !== seq ||
      !list ||
      list.length === 0 ||
      hashes.some((h) => h === null) ||
      !prev ||
      !root
    ) {
      s4.error("anchor_invalid", { seq });
      continue;
    }
    const genTime = typeof tsa.genTime === "string" ? new Date(tsa.genTime) : null;
    const anchor: Anchor = {
      seq,
      header,
      prevAnchorHash: prev,
      hash: await headerHash(header),
      batchHashes: hashes as Uint8Array[],
      declared: {
        name: String(tsa.name ?? ""),
        policyOid: String(tsa.policyOid ?? ""),
        genTime: genTime && !Number.isNaN(genTime.getTime()) ? genTime : null,
      },
    };
    anchors.set(seq, anchor);
    const sorted = anchor.batchHashes.every(
      (h, i) => i === 0 || toHex(anchor.batchHashes[i - 1]!) < toHex(h),
    );
    if (!sorted) s4.error("anchor_order", { seq });
    if (header.batchCount !== anchor.batchHashes.length) s4.error("anchor_count", { seq });
    if (!equalBytes(await merkleRoot(anchor.batchHashes), root)) s4.error("anchor_root", { seq });
    const declared = isObject(doc) ? hash32(doc.anchorHash) : null;
    if (!declared || !equalBytes(declared, anchor.hash)) s4.error("anchor_hash", { seq });
  }
  const orderedAnchors = [...anchors.values()].sort((a, b) => a.seq - b.seq);
  for (const [i, anchor] of orderedAnchors.entries()) {
    const previous = orderedAnchors[i - 1];
    // Les ancres sont communes à toutes les organisations : le pack ne joint que les siennes, la chaîne se vérifie
    // entre ancres consécutives.
    if (anchor.seq === 1 && !equalBytes(anchor.prevAnchorHash, ZERO)) {
      s4.error("anchor_chain", { seq: anchor.seq });
    }
    if (previous && anchor.seq === previous.seq + 1) {
      if (!equalBytes(anchor.prevAnchorHash, previous.hash)) {
        s4.error("anchor_chain", { seq: anchor.seq });
      }
    }
  }
  for (const batch of ordered) {
    if (!batch.anchor) {
      summary.unanchoredBatches++;
      continue;
    }
    const anchor = anchors.get(batch.anchor.seq);
    if (!anchor) {
      s4.error("anchor_missing", { batch: batch.seq, anchor: batch.anchor.seq });
      continue;
    }
    const leaf = anchor.batchHashes[batch.anchor.leafIndex];
    if (!leaf || !equalBytes(leaf, batch.hash)) {
      s4.error("anchor_leaf", { batch: batch.seq, anchor: anchor.seq });
    }
  }
  if (summary.unanchoredBatches > 0) s4.warn("unanchored", { count: summary.unanchoredBatches });

  // ── 5. Jetons d'horodatage ───────────────────────────────────────────────────────────────────────────────────────
  const notQualified = new Set<string>();
  for (const anchor of orderedAnchors) {
    const token = files[`proofs/anchors/${anchor.seq}.tst`];
    if (!token) {
      s5.error("token_missing", { seq: anchor.seq });
      continue;
    }
    const check = await verifyToken(token, anchor.hash, roots);
    if (!check.ok) {
      const code = {
        malformed: "token_malformed",
        imprint: "token_imprint",
        bad_signature: "token_signature",
        untrusted: "token_untrusted",
        not_timestamping_cert: "token_usage",
      }[check.problem] as IssueCode;
      s5.error(code, { seq: anchor.seq });
      continue;
    }
    summary.timestamps.push({
      anchor: anchor.seq,
      genTime: check.genTime.toISOString(),
      tsa: check.root.name,
      qualified: check.root.qualified,
    });
    if (
      !anchor.declared.genTime ||
      Math.abs(anchor.declared.genTime.getTime() - check.genTime.getTime()) > GEN_TIME_TOLERANCE_MS
    ) {
      s5.error("token_time", { seq: anchor.seq });
    }
    if (anchor.declared.policyOid !== check.policyOid)
      s5.error("token_policy", { seq: anchor.seq });
    for (const batch of ordered) {
      if (batch.anchor?.seq === anchor.seq && batch.sealedAt > check.genTime) {
        s5.error("sealed_after_token", { batch: batch.seq, anchor: anchor.seq });
      }
    }
    if (!check.root.qualified) notQualified.add(check.root.name);
  }
  for (const name of notQualified) s5.warn("tsa_not_qualified", { name });

  // ── 6. Recensement ───────────────────────────────────────────────────────────────────────────────────────────────
  summary.batches = ordered.length;
  summary.anchors = orderedAnchors.length;
  summary.leaves = ordered.reduce((n, b) => n + b.leaves.length, 0);
  const disclosed = evidenceIds.size - summary.redacted;
  summary.undisclosed = summary.leaves - disclosed;
  if (ordered.length > 0) {
    summary.sealedFrom = ordered[0]!.sealedAt.toISOString();
    summary.sealedTo = ordered
      .reduce((max, b) => (b.sealedAt > max ? b.sealedAt : max), ordered[0]!.sealedAt)
      .toISOString();
  }
  const counts = isObject(manifest.counts) ? manifest.counts : {};
  const actual: Record<string, number> = {
    leaves: summary.leaves,
    disclosed,
    undisclosed: summary.undisclosed,
    batches: summary.batches,
    anchors: summary.anchors,
    unanchoredBatches: summary.unanchoredBatches,
  };
  for (const [field, value] of Object.entries(actual)) {
    if (counts[field] !== value) {
      s6.error("count_mismatch", { field, expected: String(counts[field] ?? "—"), actual: value });
    }
  }
  const controls = parseJson(files["controls.json"]);
  if (Array.isArray(controls)) {
    for (const control of controls) {
      if (!isObject(control) || !Array.isArray(control.evidenceIds)) continue;
      const absent = control.evidenceIds.filter((id) => !evidenceIds.has(String(id))).length;
      if (absent > 0)
        s6.error("control_evidence", { control: String(control.key ?? ""), count: absent });
    }
  }

  return finish(pack);
}
