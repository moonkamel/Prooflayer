// Ancre globale (§4.6.2 étape 3). Fonctions pures.
//   Racine de Merkle sur les batchHash des lots sans ancre, triés par octets (prompt-type de PL-502) ;
//   anchorHash = SHA-256(JCS({ v, seq, merkleRoot, batchCount, prevAnchorHash })), empreinte soumise au prestataire.
// Encodage : empreintes en hexadécimal minuscule (convention de l'enveloppe et du lot). Première ancre : prevAnchorHash
// de 32 octets nuls.
import { createHash } from "node:crypto";
import { ZERO_HASH } from "./batch";
import { canonicalize } from "./jcs";
import { merkleRoot } from "./merkle";

export const ANCHOR_VERSION = 1;

export interface AnchorHeader {
  v: number;
  seq: number;
  merkleRoot: string;
  batchCount: number;
  prevAnchorHash: string;
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** Lots triés par leur batchHash, octet par octet : l'ordre des feuilles de l'ancre. */
export function sortBatchesForAnchor<T extends { batchHash: Uint8Array }>(
  batches: readonly T[],
): T[] {
  return [...batches].sort((a, b) =>
    Buffer.compare(Buffer.from(a.batchHash), Buffer.from(b.batchHash)),
  );
}

export function anchorHeader(input: {
  seq: number;
  batchHashes: readonly Uint8Array[];
  prevAnchorHash: Uint8Array;
}): AnchorHeader {
  if (!Number.isInteger(input.seq) || input.seq < 1) throw new RangeError("seq commence à 1");
  if (input.batchHashes.length === 0) throw new RangeError("une ancre couvre au moins un lot");
  if (input.prevAnchorHash.length !== 32) throw new RangeError("prevAnchorHash fait 32 octets");
  if (input.seq === 1 && !Buffer.from(input.prevAnchorHash).equals(ZERO_HASH)) {
    throw new RangeError("la première ancre n'a pas de prédécesseur");
  }
  const sorted = [...input.batchHashes].map((h) => Buffer.from(h)).sort(Buffer.compare);
  if (!sorted.every((h, i) => h.equals(Buffer.from(input.batchHashes[i]!)))) {
    throw new RangeError("les batchHash d'une ancre sont triés par octets");
  }
  return {
    v: ANCHOR_VERSION,
    seq: input.seq,
    merkleRoot: hex(merkleRoot(sorted)),
    batchCount: sorted.length,
    prevAnchorHash: hex(input.prevAnchorHash),
  };
}

export function anchorHash(header: AnchorHeader): Buffer {
  return createHash("sha256").update(canonicalize(header)).digest();
}

const HOUR_MS = 3_600_000;
/** Ancrage toutes les 6 heures ; alerte si un lot attend depuis plus de 6 h + 2 h (prestataire en échec, §9.7). */
export const ANCHOR_INTERVAL_MS = 6 * HOUR_MS;
export const ANCHOR_ALERT_AFTER_MS = 2 * HOUR_MS;

export function anchorOverdue(oldestPendingSealedAt: Date | null, now: Date): boolean {
  return (
    oldestPendingSealedAt !== null &&
    now.getTime() - oldestPendingSealedAt.getTime() > ANCHOR_INTERVAL_MS + ANCHOR_ALERT_AFTER_MS
  );
}
