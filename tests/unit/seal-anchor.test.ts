// PL-502 — Ancre globale (§4.6.2 étape 3) : en-tête, tri des batchHash par octets, chaînage, retard d'ancrage, fenêtre
// de 6 heures, configuration du prestataire (jamais de prestataire non qualifié implicite en production).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ANCHOR_ALERT_AFTER_MS,
  ANCHOR_INTERVAL_MS,
  anchorHash,
  anchorHeader,
  anchorOverdue,
  sortBatchesForAnchor,
} from "@/server/seal/anchor";
import { ZERO_HASH } from "@/server/seal/batch";
import { canonicalize } from "@/server/seal/jcs";
import { merkleRoot } from "@/server/seal/merkle";
import {
  FREETSA,
  FREETSA_ROOT_PEM,
  tsaSetup,
  TsaNotConfiguredError,
} from "@/server/seal/tsa-config";
import { anchorWindow } from "@/server/system/seal-schedule";

const sha = (s: string) => createHash("sha256").update(s).digest();

describe("ancre", () => {
  const batches = sortBatchesForAnchor(["c", "a", "b"].map((s) => ({ id: s, batchHash: sha(s) })));

  it("lots triés par octets de leur batchHash", () => {
    const hashes = batches.map((b) => b.batchHash);
    expect([...hashes].sort(Buffer.compare)).toEqual(hashes);
  });

  it("en-tête du §4.6.2 : { v, seq, merkleRoot, batchCount, prevAnchorHash }, empreinte sur son JCS", () => {
    const header = anchorHeader({
      seq: 1,
      batchHashes: batches.map((b) => b.batchHash),
      prevAnchorHash: ZERO_HASH,
    });
    expect(header).toEqual({
      v: 1,
      seq: 1,
      merkleRoot: merkleRoot(batches.map((b) => b.batchHash)).toString("hex"),
      batchCount: 3,
      prevAnchorHash: "0".repeat(64),
    });
    expect(
      anchorHash(header).equals(createHash("sha256").update(canonicalize(header)).digest()),
    ).toBe(true);
    const next = anchorHeader({
      seq: 2,
      batchHashes: [sha("d")],
      prevAnchorHash: anchorHash(header),
    });
    expect(next.prevAnchorHash).toBe(anchorHash(header).toString("hex"));
  });

  it("refuse une ancre vide, non triée, ou une première ancre avec prédécesseur", () => {
    const sorted = batches.map((b) => b.batchHash);
    expect(() => anchorHeader({ seq: 1, batchHashes: [], prevAnchorHash: ZERO_HASH })).toThrow(
      RangeError,
    );
    expect(() =>
      anchorHeader({ seq: 1, batchHashes: [...sorted].reverse(), prevAnchorHash: ZERO_HASH }),
    ).toThrow(RangeError);
    expect(() => anchorHeader({ seq: 1, batchHashes: sorted, prevAnchorHash: sha("x") })).toThrow(
      RangeError,
    );
    expect(() => anchorHeader({ seq: 0, batchHashes: sorted, prevAnchorHash: ZERO_HASH })).toThrow(
      RangeError,
    );
  });

  it("retard : alerte si un lot attend depuis plus de 6 h + 2 h", () => {
    const now = new Date("2026-11-13T20:00:00Z");
    const ago = (ms: number) => new Date(now.getTime() - ms);
    expect(anchorOverdue(null, now)).toBe(false);
    expect(anchorOverdue(ago(ANCHOR_INTERVAL_MS + ANCHOR_ALERT_AFTER_MS - 1000), now)).toBe(false);
    expect(anchorOverdue(ago(ANCHOR_INTERVAL_MS + ANCHOR_ALERT_AFTER_MS + 1000), now)).toBe(true);
  });

  it("fenêtres de 6 heures UTC", () => {
    expect(anchorWindow(new Date("2026-11-13T05:59:00Z"))).toBe("2026-11-13T00");
    expect(anchorWindow(new Date("2026-11-13T06:00:00Z"))).toBe("2026-11-13T06");
    expect(anchorWindow(new Date("2026-11-13T23:10:00Z"))).toBe("2026-11-13T18");
  });
});

describe("prestataire", () => {
  it("hors production sans configuration : freetsa.org, non qualifié", () => {
    const setup = tsaSetup({});
    expect(setup.config).toBe(FREETSA);
    expect(setup.qualified).toBe(false);
    expect(setup.trustAnchors).toHaveLength(1);
  });

  it("production sans prestataire configuré : refus, jamais de repli sur un prestataire non qualifié", () => {
    expect(() => tsaSetup({ VERCEL_ENV: "production" })).toThrow(TsaNotConfiguredError);
    expect(() =>
      tsaSetup({ VERCEL_ENV: "production", TSA_URL: "https://tsa.example.eu/tsr" }),
    ).toThrow(TsaNotConfiguredError);
  });

  it("prestataire configuré : adresse, politique, authentification, certificats de confiance", () => {
    const setup = tsaSetup({
      VERCEL_ENV: "production",
      TSA_URL: "https://tsa.example.eu/tsr",
      TSA_NAME: "Prestataire qualifié",
      TSA_POLICY_OID: "1.2.3.4",
      TSA_USER: "u",
      TSA_PASSWORD: "p",
      TSA_QUALIFIED: "true",
      // Le PEM épinglé sert ici de certificat de confiance d'exemple.
      TSA_TRUST_PEM: FREETSA_ROOT_PEM,
    });
    expect(setup.config).toMatchObject({
      name: "Prestataire qualifié",
      url: "https://tsa.example.eu/tsr",
      policyOid: "1.2.3.4",
      auth: { type: "basic", user: "u", pass: "p" },
    });
    expect(setup.qualified).toBe(true);
    expect(setup.trustAnchors).toHaveLength(1);
  });
});
