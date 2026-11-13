// Preuve d'inclusion et revérification de la chaîne (PL-503, §4.6.2 et §4.6.3). Fonctions pures.
// - `buildProof` : le chemin d'une preuve jusqu'au jeton d'horodatage (feuille → racine du lot → batchHash → racine de
//   l'ancre → anchorHash → jeton RFC 3161). `verifyProof` le revérifie sans base (le jeton se vérifie à part,
//   `verifyTimestamp`, asynchrone).
// - `leafIssues`, `batchIssues`, `anchorIssues` : ce que le job quotidien recalcule pour chaque feuille, lot et ancre.
// Encodage : empreintes en hexadécimal minuscule, dates ISO 8601 (convention de l'enveloppe, PL-304).
import { anchorHash, anchorHeader, type AnchorHeader } from "./anchor";
import { batchHash, batchHeader, ZERO_HASH, type BatchHeader } from "./batch";
import { contentSha256, envelopeOf, evidenceLeafHash, type EnvelopeInput } from "./evidence";
import { inclusionProof, merkleRoot, verifyInclusion } from "./merkle";

export const PROOF_VERSION = 1;

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const unhex = (value: string) => Buffer.from(value, "hex");
const equal = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

export interface ProofBundle {
  v: number;
  evidence: { id: string; leafHash: string; leafIndex: number };
  batch: { header: BatchHeader; batchHash: string; path: string[] };
  /** Null tant que le lot attend son ancre (au plus 6 heures, §4.6.4). */
  anchor: {
    header: AnchorHeader;
    anchorHash: string;
    leafIndex: number;
    path: string[];
    tsa: { name: string; policyOid: string; genTime: string; token: string };
  } | null;
}

export interface StoredBatch {
  orgId: string;
  seq: number;
  leafCount: number;
  merkleRoot: Uint8Array;
  prevBatchHash: Uint8Array;
  batchHash: Uint8Array;
  sealedAt: Date;
}

export interface StoredAnchor {
  seq: number;
  batchCount: number;
  merkleRoot: Uint8Array;
  prevAnchorHash: Uint8Array;
  anchorHash: Uint8Array;
  tsaName: string;
  tsaPolicyOid: string;
  tsaToken: Uint8Array;
  tsaGenTime: Date;
}

/** En-tête d'un lot tel qu'il est stocké (le recalcul de son empreinte est vérifié par `batchIssues`). */
export function storedBatchHeader(b: StoredBatch): BatchHeader {
  return {
    v: 1,
    org: b.orgId,
    seq: b.seq,
    leafCount: b.leafCount,
    merkleRoot: hex(b.merkleRoot),
    prevBatchHash: hex(b.prevBatchHash),
    sealedAt: b.sealedAt.toISOString(),
  };
}

export function storedAnchorHeader(a: StoredAnchor): AnchorHeader {
  return {
    v: 1,
    seq: a.seq,
    merkleRoot: hex(a.merkleRoot),
    batchCount: a.batchCount,
    prevAnchorHash: hex(a.prevAnchorHash),
  };
}

/** Chemin d'une preuve jusqu'au jeton : feuilles du lot et lots de l'ancre dans leur ordre d'index. */
export function buildProof(input: {
  evidence: { id: string; leafHash: Uint8Array; leafIndex: number };
  batch: StoredBatch;
  batchLeaves: readonly Uint8Array[];
  anchor: (StoredAnchor & { batchLeafIndex: number; batchLeaves: readonly Uint8Array[] }) | null;
}): ProofBundle {
  const { evidence, batch, anchor } = input;
  return {
    v: PROOF_VERSION,
    evidence: { id: evidence.id, leafHash: hex(evidence.leafHash), leafIndex: evidence.leafIndex },
    batch: {
      header: storedBatchHeader(batch),
      batchHash: hex(batch.batchHash),
      path: inclusionProof([...input.batchLeaves], evidence.leafIndex).map(hex),
    },
    anchor: anchor
      ? {
          header: storedAnchorHeader(anchor),
          anchorHash: hex(anchor.anchorHash),
          leafIndex: anchor.batchLeafIndex,
          path: inclusionProof([...anchor.batchLeaves], anchor.batchLeafIndex).map(hex),
          tsa: {
            name: anchor.tsaName,
            policyOid: anchor.tsaPolicyOid,
            genTime: anchor.tsaGenTime.toISOString(),
            token: Buffer.from(anchor.tsaToken).toString("base64"),
          },
        }
      : null,
  };
}

export type ProofStep = "leaf" | "batchHash" | "anchorLeaf" | "anchorHash";

/**
 * Revérifie un chemin (étapes 3 et 4 du §4.6.3) : feuille dans la racine du lot, empreinte de l'en-tête du lot, lot dans
 * la racine de l'ancre, empreinte de l'en-tête de l'ancre. Le jeton (étape 5) est vérifié par `verifyTimestamp`.
 */
export function verifyProof(bundle: ProofBundle): { ok: true } | { ok: false; step: ProofStep } {
  const { evidence, batch, anchor } = bundle;
  if (
    !verifyInclusion(
      unhex(evidence.leafHash),
      evidence.leafIndex,
      batch.header.leafCount,
      batch.path.map(unhex),
      unhex(batch.header.merkleRoot),
    )
  ) {
    return { ok: false, step: "leaf" };
  }
  if (hex(batchHash(batch.header)) !== batch.batchHash) return { ok: false, step: "batchHash" };
  if (!anchor) return { ok: true };
  if (
    !verifyInclusion(
      unhex(batch.batchHash),
      anchor.leafIndex,
      anchor.header.batchCount,
      anchor.path.map(unhex),
      unhex(anchor.header.merkleRoot),
    )
  ) {
    return { ok: false, step: "anchorLeaf" };
  }
  if (hex(anchorHash(anchor.header)) !== anchor.anchorHash)
    return { ok: false, step: "anchorHash" };
  return { ok: true };
}

// ───────────── Revérification quotidienne ─────────────

export type IntegrityIssue =
  | { kind: "content"; evidenceId: string }
  | { kind: "leaf"; evidenceId: string }
  | { kind: "batchRoot"; seq: number }
  | { kind: "batchCount"; seq: number }
  | { kind: "batchHash"; seq: number }
  | { kind: "batchChain"; seq: number }
  | { kind: "anchorRoot"; seq: number }
  | { kind: "anchorCount"; seq: number }
  | { kind: "anchorHash"; seq: number }
  | { kind: "anchorChain"; seq: number };

/**
 * Une preuve : contentSha256 recalculé sur la charge (sauf effacement), leafHash recalculé sur le sel et l'enveloppe
 * (sauf effacement : sans le sel, seul le leafHash reste, §4.6.5).
 */
export function leafIssues(
  e: EnvelopeInput & { salt: Uint8Array | null; leafHash: Uint8Array; payload: unknown | null },
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  if (
    e.payload !== null &&
    e.payload !== undefined &&
    !equal(contentSha256(e.payload), e.contentSha256)
  ) {
    issues.push({ kind: "content", evidenceId: e.id });
  }
  if (e.salt && !equal(evidenceLeafHash(e.salt, envelopeOf(e)), e.leafHash)) {
    issues.push({ kind: "leaf", evidenceId: e.id });
  }
  return issues;
}

/**
 * Les lots d'une organisation, dans l'ordre de seq, avec les leafHash de leurs preuves dans l'ordre de leafIndex :
 * racine et nombre de feuilles, empreinte de l'en-tête, chaînage (seq sans trou, prevBatchHash).
 */
export function batchIssues(
  batches: readonly (StoredBatch & { leaves: readonly Uint8Array[] })[],
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  let previous: Uint8Array = ZERO_HASH;
  for (const [i, b] of batches.entries()) {
    if (b.leaves.length !== b.leafCount) issues.push({ kind: "batchCount", seq: b.seq });
    if (!equal(merkleRoot([...b.leaves]), b.merkleRoot))
      issues.push({ kind: "batchRoot", seq: b.seq });
    if (!equal(batchHash(storedBatchHeader(b)), b.batchHash))
      issues.push({ kind: "batchHash", seq: b.seq });
    if (b.seq !== i + 1 || !equal(b.prevBatchHash, previous))
      issues.push({ kind: "batchChain", seq: b.seq });
    previous = b.batchHash;
  }
  return issues;
}

/** Les ancres dans l'ordre de seq, avec les batchHash de leurs lots dans l'ordre d'anchorLeafIndex. */
export function anchorIssues(
  anchors: readonly (StoredAnchor & { batchHashes: readonly Uint8Array[] })[],
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  let previous: Uint8Array = ZERO_HASH;
  for (const [i, a] of anchors.entries()) {
    if (a.batchHashes.length !== a.batchCount) issues.push({ kind: "anchorCount", seq: a.seq });
    if (!equal(merkleRoot([...a.batchHashes]), a.merkleRoot))
      issues.push({ kind: "anchorRoot", seq: a.seq });
    if (!equal(anchorHash(storedAnchorHeader(a)), a.anchorHash))
      issues.push({ kind: "anchorHash", seq: a.seq });
    if (a.seq !== i + 1 || !equal(a.prevAnchorHash, previous))
      issues.push({ kind: "anchorChain", seq: a.seq });
    previous = a.anchorHash;
  }
  return issues;
}

// Réexportés pour les tests et les appelants qui reconstruisent un en-tête de zéro.
export { anchorHeader, batchHeader };
