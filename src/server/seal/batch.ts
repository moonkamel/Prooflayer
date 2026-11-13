// Lot horaire d'une organisation (§4.6.2, étape 2). Fonctions pures.
//   Les preuves non scellées sont triées par (capturedAt, id) ; racine de Merkle RFC 6962 sur leurs leafHash ;
//   batchHash = SHA-256(JCS({ v, org, seq, leafCount, merkleRoot, prevBatchHash, sealedAt })).
// Encodage (même convention que l'enveloppe, PL-304) : empreintes en hexadécimal minuscule, date ISO 8601 UTC à la
// milliseconde. Le premier lot d'une organisation (seq = 1) a un prevBatchHash de 32 octets nuls.
import { createHash } from "node:crypto";
import { canonicalize } from "./jcs";
import { merkleRoot } from "./merkle";

export const BATCH_VERSION = 1;
export const ZERO_HASH = Buffer.alloc(32);

export interface BatchHeader {
  v: number;
  org: string;
  seq: number;
  leafCount: number;
  merkleRoot: string;
  prevBatchHash: string;
  sealedAt: string;
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** Ordre des feuilles d'un lot : capturedAt, puis identifiant (unités de code, comme le tri JCS). */
export function sortForSealing<T extends { id: string; capturedAt: Date }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      a.capturedAt.getTime() - b.capturedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function batchHeader(input: {
  orgId: string;
  seq: number;
  leafHashes: readonly Uint8Array[];
  prevBatchHash: Uint8Array;
  sealedAt: Date;
}): BatchHeader {
  if (!Number.isInteger(input.seq) || input.seq < 1) throw new RangeError("seq commence à 1");
  if (input.leafHashes.length === 0) throw new RangeError("un lot contient au moins une preuve");
  if (input.prevBatchHash.length !== 32) throw new RangeError("prevBatchHash fait 32 octets");
  if (input.seq === 1 && !Buffer.from(input.prevBatchHash).equals(ZERO_HASH)) {
    throw new RangeError("le premier lot n'a pas de prédécesseur");
  }
  return {
    v: BATCH_VERSION,
    org: input.orgId,
    seq: input.seq,
    leafCount: input.leafHashes.length,
    merkleRoot: hex(merkleRoot([...input.leafHashes])),
    prevBatchHash: hex(input.prevBatchHash),
    sealedAt: input.sealedAt.toISOString(),
  };
}

export function batchHash(header: BatchHeader): Buffer {
  return createHash("sha256").update(canonicalize(header)).digest();
}

/**
 * Continuité d'une chaîne de lots (§4.6.3, étape 3) : seq de 1 à n sans trou, chaque prevBatchHash égal au batchHash
 * recalculé du lot précédent. Renvoie la première rupture, ou null.
 */
export function chainBreak(
  headers: readonly BatchHeader[],
): { seq: number; reason: "gap" | "prev" | "first" } | null {
  let previous: Buffer | null = null;
  for (const [i, header] of headers.entries()) {
    if (header.seq !== i + 1) return { seq: header.seq, reason: "gap" };
    if (i === 0 && header.prevBatchHash !== hex(ZERO_HASH))
      return { seq: header.seq, reason: "first" };
    if (previous && header.prevBatchHash !== hex(previous))
      return { seq: header.seq, reason: "prev" };
    previous = batchHash(header);
  }
  return null;
}
