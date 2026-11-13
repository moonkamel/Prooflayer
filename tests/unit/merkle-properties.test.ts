// PL-501 — Propriétés du module Merkle du §4.6.2 (RFC 6962), sur tous les arbres de 1 à 257 feuilles (exhaustif) :
// toute feuille se vérifie contre la racine ; toute altération (feuille, index, taille, chemin, racine) échoue.
// Les altérations sont tirées par un générateur pseudo-aléatoire à graine fixe : le test est reproductible.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inclusionProof, merkleRoot, verifyInclusion } from "@/server/seal/merkle";

const MAX_LEAVES = 257;
const leaves = Array.from({ length: MAX_LEAVES }, (_, i) =>
  createHash("sha256").update(`feuille ${i}`).digest(),
);

/** xorshift32 : générateur reproductible. */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return (max: number) => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x % max;
  };
}

/** Copie avec un bit inversé, à une position tirée. */
function flipBit(bytes: Uint8Array, pick: (max: number) => number): Buffer {
  const copy = Buffer.from(bytes);
  const at = pick(copy.length);
  copy[at] = copy[at]! ^ (1 << pick(8));
  return copy;
}

describe("Merkle : propriétés sur 1 à 257 feuilles", () => {
  it("toute feuille de tout arbre se vérifie contre sa racine", { timeout: 120_000 }, () => {
    let checked = 0;
    for (let n = 1; n <= MAX_LEAVES; n++) {
      const tree = leaves.slice(0, n);
      const root = merkleRoot(tree);
      for (let i = 0; i < n; i++) {
        const proof = inclusionProof(tree, i);
        // Chemin logarithmique : au plus ⌈log2 n⌉ nœuds.
        expect(proof.length).toBeLessThanOrEqual(Math.ceil(Math.log2(n)));
        if (!verifyInclusion(tree[i]!, i, n, proof, root)) {
          throw new Error(`feuille ${i} de l'arbre de ${n} non vérifiée`);
        }
        checked += 1;
      }
    }
    expect(checked).toBe((MAX_LEAVES * (MAX_LEAVES + 1)) / 2);
  });

  it(
    "toute altération échoue : feuille, nœud du chemin, racine, index, chemin tronqué ou allongé",
    { timeout: 120_000 },
    () => {
      const pick = rng(0x5eed);
      for (let n = 1; n <= MAX_LEAVES; n++) {
        const tree = leaves.slice(0, n);
        const root = merkleRoot(tree);
        for (let i = 0; i < n; i++) {
          const leaf = tree[i]!;
          const proof = inclusionProof(tree, i);
          const fail = (what: string, ok: boolean) => {
            if (ok) throw new Error(`${what} acceptée : feuille ${i} de l'arbre de ${n}`);
          };
          fail("feuille altérée", verifyInclusion(flipBit(leaf, pick), i, n, proof, root));
          fail("racine altérée", verifyInclusion(leaf, i, n, proof, flipBit(root, pick)));
          if (proof.length > 0) {
            const k = pick(proof.length);
            const tampered = proof.map((p, j) => (j === k ? flipBit(p, pick) : p));
            fail("chemin altéré", verifyInclusion(leaf, i, n, tampered, root));
            fail("chemin tronqué", verifyInclusion(leaf, i, n, proof.slice(1), root));
          }
          fail("chemin allongé en haut", verifyInclusion(leaf, i, n, [...proof, leaf], root));
          fail("chemin allongé en bas", verifyInclusion(leaf, i, n, [leaf, ...proof], root));
          if (n > 1) {
            // Autre index de la même taille : la position est liée par le chemin.
            const other = (i + 1 + pick(n - 1)) % n;
            fail("index déplacé", verifyInclusion(leaf, other, n, proof, root));
          }
          fail("index hors arbre", verifyInclusion(leaf, n, n, proof, root));
          fail("index négatif", verifyInclusion(leaf, -1, n, proof, root));
        }
      }
    },
  );

  it("un ordre différent des feuilles donne une autre racine (l'ordre de tri est lié)", () => {
    for (let n = 2; n <= MAX_LEAVES; n += 17) {
      const tree = leaves.slice(0, n);
      const swapped = [tree[1]!, tree[0]!, ...tree.slice(2)];
      expect(merkleRoot(swapped).equals(merkleRoot(tree))).toBe(false);
    }
  });
});
