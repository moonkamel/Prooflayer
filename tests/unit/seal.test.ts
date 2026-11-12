// PL-304 — Cryptographie des preuves (§4.6.2) : canonicalisation JSON RFC 8785, arbre de Merkle RFC 6962,
// empreinte de contenu, enveloppe et feuille.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalize } from "@/server/seal/jcs";
import { inclusionProof, leafHash, merkleRoot, verifyInclusion } from "@/server/seal/merkle";
import { contentSha256, envelopeOf, evidenceLeafHash } from "@/server/seal/evidence";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest();

describe("JCS (RFC 8785)", () => {
  it("trie les clés par unités UTF-16, sans espaces", () => {
    expect(canonicalize({ b: 1, a: [true, null, "x"], c: { z: 1, y: 2 } })).toBe(
      '{"a":[true,null,"x"],"b":1,"c":{"y":2,"z":1}}',
    );
    // Exemple de tri de la RFC 8785 §3.2.3 (unités UTF-16, pas points de code).
    const keys = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      דּ: "Hebrew",
      "1": "One",
      "\u0080": "Control",
      "😀": "Smiley",
      ö: "Latin Small Letter O With Diaeresis",
    };
    // Ordre lu dans la chaîne canonique (Object.keys remettrait les clés numériques en tête).
    const order = [...canonicalize(keys).matchAll(/"((?:[^"\\]|\\.)*)":"/gu)].map((m) =>
      JSON.parse(`"${m[1]}"`),
    );
    expect(order).toEqual(["\r", "1", "\u0080", "\u00f6", "\u20ac", "\ud83d\ude00", "\ufb33"]);
  });

  it("sérialise les nombres comme ECMAScript (RFC 8785 §3.2.2.3)", () => {
    expect(canonicalize([0, -0, 1e21, 1e-7, 333333333.3333333, 4.5, 1e30, -1.5e-10])).toBe(
      "[0,0,1e+21,1e-7,333333333.3333333,4.5,1e+30,-1.5e-10]",
    );
  });

  it("échappe les chaînes comme JSON.stringify, sans échapper l'Unicode imprimable", () => {
    expect(canonicalize({ s: 'é"\\\n\u0001' })).toBe('{"s":"é\\"\\\\\\n\\u0001"}');
  });

  it("refuse ce que JSON ne représente pas", () => {
    expect(() => canonicalize(Number.NaN)).toThrow();
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => canonicalize({ a: undefined })).toThrow();
    expect(() => canonicalize(new Date())).toThrow();
    expect(() => canonicalize(1n as never)).toThrow();
  });
});

describe("Merkle (RFC 6962)", () => {
  const leaves = Array.from({ length: 7 }, (_, i) => sha(`feuille ${i}`));

  it("racine d'un arbre vide, d'une feuille, et préfixes 0x00 / 0x01", () => {
    expect(merkleRoot([]).equals(sha(""))).toBe(true);
    expect(merkleRoot([leaves[0]!]).equals(leaves[0]!)).toBe(true);
    const two = sha(Buffer.concat([Buffer.of(0x01), leaves[0]!, leaves[1]!]));
    expect(merkleRoot(leaves.slice(0, 2)).equals(two)).toBe(true);
    expect(
      leafHash(Buffer.alloc(32, 1), Buffer.from("x")).equals(
        sha(Buffer.concat([Buffer.of(0x00), Buffer.alloc(32, 1), Buffer.from("x")])),
      ),
    ).toBe(true);
  });

  it("chaque feuille a une preuve d'inclusion valide, quelle que soit la taille", () => {
    for (let n = 1; n <= leaves.length; n++) {
      const tree = leaves.slice(0, n);
      const root = merkleRoot(tree);
      for (let i = 0; i < n; i++) {
        expect(verifyInclusion(tree[i]!, i, n, inclusionProof(tree, i), root), `${i}/${n}`).toBe(
          true,
        );
      }
    }
  });

  it("refuse une feuille, un index, une taille ou une preuve altérés", () => {
    const root = merkleRoot(leaves);
    const proof = inclusionProof(leaves, 3);
    expect(verifyInclusion(leaves[4]!, 3, 7, proof, root)).toBe(false);
    expect(verifyInclusion(leaves[3]!, 4, 7, proof, root)).toBe(false);
    // La taille de l'arbre n'est pas liée par la preuve elle-même : elle l'est par l'en-tête du lot (leafCount,
    // inclus dans batchHash), vérifié séparément (§4.6.3, étape 3).
    expect(verifyInclusion(leaves[3]!, 3, 7, proof.slice(1), root)).toBe(false);
    expect(verifyInclusion(leaves[3]!, 7, 7, proof, root)).toBe(false);
    const tampered = proof.map((p) => Buffer.from(p));
    tampered[0]!.writeUInt8(tampered[0]!.readUInt8(0) ^ 1, 0);
    expect(verifyInclusion(leaves[3]!, 3, 7, tampered, root)).toBe(false);
  });
});

describe("preuve : empreinte, enveloppe, feuille (§4.6.2, étape 1)", () => {
  const payload = { number: 42, merged: true, title: undefined as never, reviewers: ["a"] };
  const clean = { number: 42, merged: true, reviewers: ["a"] };

  it("contentSha256 = SHA-256(JCS(payload)), indépendant de l'ordre des clés", () => {
    expect(contentSha256({ b: 2, a: 1 }).equals(sha('{"a":1,"b":2}'))).toBe(true);
    expect(contentSha256({ a: 1, b: 2 }).equals(contentSha256({ b: 2, a: 1 }))).toBe(true);
    expect(() => contentSha256(payload)).toThrow();
    expect(contentSha256(clean).length).toBe(32);
  });

  it("enveloppe : champs du §4.6.2, empreintes en hexadécimal, dates ISO 8601", () => {
    const envelope = envelopeOf({
      orgId: "org_1",
      id: "ev_1",
      kind: "github.pull_request.merged",
      sourceRef: "gh:pr:1:42",
      occurredAt: new Date("2026-11-01T10:00:00Z"),
      capturedAt: new Date("2026-11-01T10:00:05Z"),
      contentSha256: Buffer.alloc(32, 0xab),
      attachmentSha256: null,
    });
    expect(Object.keys(envelope).sort()).toEqual(
      [
        "attachmentSha256",
        "capturedAt",
        "contentSha256",
        "id",
        "kind",
        "occurredAt",
        "org",
        "sourceRef",
        "v",
      ].sort(),
    );
    expect(envelope).toMatchObject({
      v: 1,
      org: "org_1",
      occurredAt: "2026-11-01T10:00:00.000Z",
      contentSha256: "ab".repeat(32),
      attachmentSha256: null,
    });
    const salt = Buffer.alloc(32, 7);
    expect(
      evidenceLeafHash(salt, envelope).equals(
        sha(Buffer.concat([Buffer.of(0x00), salt, Buffer.from(canonicalize(envelope))])),
      ),
    ).toBe(true);
    expect(() => evidenceLeafHash(Buffer.alloc(16), envelope)).toThrow();
  });
});
