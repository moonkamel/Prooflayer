// PL-501 — En-tête de lot (§4.6.2, étape 2) : tri des feuilles, batchHash sur l'en-tête canonique, chaînage.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { batchHash, batchHeader, chainBreak, sortForSealing, ZERO_HASH } from "@/server/seal/batch";
import { canonicalize } from "@/server/seal/jcs";
import { merkleRoot } from "@/server/seal/merkle";

const sha = (s: string) => createHash("sha256").update(s).digest();
const at = new Date("2026-11-13T13:00:00.000Z");

describe("lot", () => {
  it("tri par capturedAt puis identifiant", () => {
    const t = (iso: string) => new Date(iso);
    const items = [
      { id: "ev_b", capturedAt: t("2026-11-13T12:10:00Z") },
      { id: "ev_c", capturedAt: t("2026-11-13T12:05:00Z") },
      { id: "ev_a", capturedAt: t("2026-11-13T12:10:00Z") },
    ];
    expect(sortForSealing(items).map((i) => i.id)).toEqual(["ev_c", "ev_a", "ev_b"]);
  });

  it("en-tête du §4.6.2 : champs, encodage hexadécimal et ISO, empreinte sur le JCS de l'en-tête", () => {
    const leaves = [sha("a"), sha("b"), sha("c")];
    const header = batchHeader({
      orgId: "org_1",
      seq: 1,
      leafHashes: leaves,
      prevBatchHash: ZERO_HASH,
      sealedAt: at,
    });
    expect(header).toEqual({
      v: 1,
      org: "org_1",
      seq: 1,
      leafCount: 3,
      merkleRoot: merkleRoot(leaves).toString("hex"),
      prevBatchHash: "0".repeat(64),
      sealedAt: "2026-11-13T13:00:00.000Z",
    });
    expect(
      batchHash(header).equals(createHash("sha256").update(canonicalize(header)).digest()),
    ).toBe(true);
    // Chaque champ entre dans l'empreinte.
    for (const change of [
      { seq: 2 },
      { leafCount: 4 },
      { org: "org_2" },
      { sealedAt: "2026-11-13T13:00:00.001Z" },
    ]) {
      expect(batchHash({ ...header, ...change }).equals(batchHash(header))).toBe(false);
    }
  });

  it("refuse un lot vide, un seq < 1, un premier lot avec prédécesseur", () => {
    const base = { orgId: "o", leafHashes: [sha("a")], prevBatchHash: ZERO_HASH, sealedAt: at };
    expect(() => batchHeader({ ...base, seq: 0 })).toThrow(RangeError);
    expect(() => batchHeader({ ...base, seq: 1, leafHashes: [] })).toThrow(RangeError);
    expect(() => batchHeader({ ...base, seq: 1, prevBatchHash: sha("x") })).toThrow(RangeError);
    expect(() => batchHeader({ ...base, seq: 2, prevBatchHash: Buffer.alloc(31) })).toThrow(
      RangeError,
    );
  });

  it("chaînage : continuité vérifiée, trou ou maillon altéré détecté", () => {
    const headers = [];
    let prev: Buffer = ZERO_HASH;
    for (let seq = 1; seq <= 4; seq++) {
      const h = batchHeader({
        orgId: "o",
        seq,
        leafHashes: [sha(`l${seq}`)],
        prevBatchHash: prev,
        sealedAt: at,
      });
      headers.push(h);
      prev = batchHash(h);
    }
    expect(chainBreak(headers)).toBeNull();
    expect(chainBreak([headers[0]!, headers[2]!])).toEqual({ seq: 3, reason: "gap" });
    const altered = headers.map((h, i) => (i === 1 ? { ...h, leafCount: 9 } : h));
    expect(chainBreak(altered)).toEqual({ seq: 3, reason: "prev" });
    expect(chainBreak([{ ...headers[0]!, prevBatchHash: "1".repeat(64) }])).toEqual({
      seq: 1,
      reason: "first",
    });
  });
});
