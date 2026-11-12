// PL-304 — Chiffrement en enveloppe (§4.7) : AES-256-GCM, clé de données par organisation sous clé maîtresse.
import { describe, expect, it } from "vitest";
import {
  decrypt,
  encrypt,
  generateKey,
  masterKeyFromEnv,
  unwrapKey,
  wrapKey,
} from "@/server/crypto/envelope";

describe("chiffrement en enveloppe", () => {
  const key = generateKey();

  it("déchiffre ce qu'il a chiffré, avec un IV différent à chaque fois", () => {
    const a = encrypt(key, Buffer.from("charge brute"), "raw:org:ev");
    const b = encrypt(key, Buffer.from("charge brute"), "raw:org:ev");
    expect(a.equals(b)).toBe(false);
    expect(decrypt(key, a, "raw:org:ev").toString()).toBe("charge brute");
  });

  it("refuse une autre clé, un autre contexte (AAD) ou un chiffré altéré", () => {
    const sealed = encrypt(key, Buffer.from("x"), "raw:org_a:ev_1");
    expect(() => decrypt(generateKey(), sealed, "raw:org_a:ev_1")).toThrow();
    expect(() => decrypt(key, sealed, "raw:org_b:ev_1")).toThrow();
    const tampered = Buffer.from(sealed);
    tampered.writeUInt8(tampered.readUInt8(tampered.length - 1) ^ 1, tampered.length - 1);
    expect(() => decrypt(key, tampered, "raw:org_a:ev_1")).toThrow();
    expect(() => decrypt(key, Buffer.from([2, 0, 0]), "x")).toThrow("chiffré illisible");
    expect(() => encrypt(Buffer.alloc(16), Buffer.from("x"), "x")).toThrow();
  });

  it("clé maîtresse : lue en base64, identifiée, 32 octets exigés", () => {
    const master = masterKeyFromEnv({ PROOFLAYER_MASTER_KEY: key.toString("base64") });
    expect(master.id).toMatch(/^env:[0-9a-f]{12}$/u);
    const dek = generateKey();
    const wrapped = wrapKey(master, dek, "org_a");
    expect(unwrapKey(master, wrapped, "org_a").equals(dek)).toBe(true);
    expect(() => unwrapKey(master, wrapped, "org_b")).toThrow();
    expect(() => masterKeyFromEnv({})).toThrow("PROOFLAYER_MASTER_KEY absente");
    expect(() => masterKeyFromEnv({ PROOFLAYER_MASTER_KEY: "Zm9v" })).toThrow("32 octets");
  });
});
