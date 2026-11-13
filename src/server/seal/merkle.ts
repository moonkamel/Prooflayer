// src/server/seal/merkle.ts — arbre de Merkle selon la RFC 6962, §2.1 (code repris du §4.6.2 du cahier des charges).
import { createHash } from "node:crypto";

const sha256 = (...parts: Uint8Array[]): Buffer => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};

export const leafHash = (salt: Uint8Array, canonicalEnvelope: Uint8Array): Buffer =>
  sha256(Uint8Array.of(0x00), salt, canonicalEnvelope);

const nodeHash = (left: Uint8Array, right: Uint8Array): Buffer =>
  sha256(Uint8Array.of(0x01), left, right);

/** Plus grande puissance de 2 strictement inférieure à n (n >= 2). */
const split = (n: number): number => {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
};

export function merkleRoot(leaves: Uint8Array[]): Buffer {
  if (leaves.length === 0) return sha256();
  if (leaves.length === 1) return Buffer.from(leaves[0]!);
  const k = split(leaves.length);
  return nodeHash(merkleRoot(leaves.slice(0, k)), merkleRoot(leaves.slice(k)));
}

/** Chemin d'audit de la feuille `index`, du bas vers le haut. */
export function inclusionProof(leaves: Uint8Array[], index: number): Buffer[] {
  if (leaves.length <= 1) return [];
  const k = split(leaves.length);
  return index < k
    ? [...inclusionProof(leaves.slice(0, k), index), merkleRoot(leaves.slice(k))]
    : [...inclusionProof(leaves.slice(k), index - k), merkleRoot(leaves.slice(0, k))];
}

export function verifyInclusion(
  leaf: Uint8Array,
  index: number,
  treeSize: number,
  proof: Uint8Array[],
  root: Uint8Array,
): boolean {
  const recompute = (i: number, n: number, path: Uint8Array[]): Buffer => {
    // PL-501 : le chemin doit être consommé en entier (RFC 9162 §2.1.3.2). Le code du §4.6.2 ignorait les nœuds en
    // trop au bas du chemin : une preuve malléable, refusée ici.
    if (n === 1) {
      if (path.length !== 0) throw new Error("preuve trop longue");
      return Buffer.from(leaf);
    }
    const k = split(n);
    const sibling = path[path.length - 1];
    if (!sibling) throw new Error("preuve trop courte");
    const rest = path.slice(0, -1);
    return i < k
      ? nodeHash(recompute(i, k, rest), sibling)
      : nodeHash(sibling, recompute(i - k, n - k, rest));
  };
  try {
    return (
      index >= 0 && index < treeSize && recompute(index, treeSize, proof).equals(Buffer.from(root))
    );
  } catch {
    return false;
  }
}
