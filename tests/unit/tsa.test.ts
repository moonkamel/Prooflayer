// PL-502 — Client RFC 3161 sur un jeton réel (freetsa.org, prestataire de test non qualifié, fixture enregistrée dans
// tests/fixtures/tsa/ et vérifiée par `openssl ts -verify`) : acceptation, empreinte altérée, nonce altéré, statut
// « rejection », signature altérée, chaîne inconnue, délai dépassé (erreur réessayable). Aucun appel réseau.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as pkijs from "pkijs";
import { describe, expect, it } from "vitest";
import {
  buildTimestampRequest,
  certificatesFromPem,
  parseTimestampResponse,
  requestTimestamp,
  TsaError,
  verifyTimestamp,
  type TsaConfig,
} from "@/server/seal/tsa";

const dir = join(process.cwd(), "tests/fixtures/tsa");
const digest = new Uint8Array(readFileSync(join(dir, "digest.bin")));
const responseDer = new Uint8Array(readFileSync(join(dir, "response.tsr")));
const requestDer = new Uint8Array(readFileSync(join(dir, "request.tsq")));
const anchors = certificatesFromPem(readFileSync(join(dir, "cacert.pem"), "utf8"));
const requestNonce = new Uint8Array(
  pkijs.TimeStampReq.fromBER(requestDer.buffer.slice(0) as ArrayBuffer).nonce!.valueBlock
    .valueHexView,
);
const config: TsaConfig = { name: "freetsa", url: "https://tsa.example.test/tsr", timeoutMs: 1000 };

const reply = (body: Uint8Array, init: { status?: number; type?: string } = {}) =>
  new Response(Buffer.from(body), {
    status: init.status ?? 200,
    headers: { "content-type": init.type ?? "application/timestamp-reply" },
  });
const code = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    return e instanceof TsaError ? e.code : `autre : ${String(e)}`;
  }
  return "aucune erreur";
};
const flip = (bytes: Uint8Array, at: number) => {
  const copy = new Uint8Array(bytes);
  copy[at] = copy[at]! ^ 0x01;
  return copy;
};

describe("requête RFC 3161", () => {
  it("version 1, SHA-256, empreinte, nonce, certReq", () => {
    const nonce = Uint8Array.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
    const der = buildTimestampRequest(digest, nonce);
    const req = pkijs.TimeStampReq.fromBER(der.buffer.slice(0) as ArrayBuffer);
    expect(req.version).toBe(1);
    expect(req.messageImprint.hashAlgorithm.algorithmId).toBe("2.16.840.1.101.3.4.2.1");
    expect(
      Buffer.from(req.messageImprint.hashedMessage.getValue()).equals(Buffer.from(digest)),
    ).toBe(true);
    expect(Buffer.from(req.nonce!.valueBlock.valueHexView).toString("hex")).toBe(
      "123456789abcdef0",
    );
    expect(req.certReq).toBe(true);
    expect(() => buildTimestampRequest(digest.slice(1), nonce)).toThrow(RangeError);
  });
});

describe("réponse et jeton réels", () => {
  it("accepte le jeton du prestataire de test : date, numéro de série, politique, signataire", async () => {
    const { token, tst } = parseTimestampResponse(responseDer, { digest, nonce: requestNonce });
    expect(tst.genTime.toISOString()).toMatch(/^2026-11-13T/u);
    const verified = await verifyTimestamp(token, digest, anchors);
    expect(verified.genTime.getTime()).toBe(tst.genTime.getTime());
    expect(verified.serial).toMatch(/^[0-9a-f]+$/u);
    expect(verified.policyOid).toMatch(/^\d+(\.\d+)+$/u);
    expect(verified.signer).toContain("freetsa");
  });

  it("empreinte altérée → rejet", async () => {
    const { token } = parseTimestampResponse(responseDer, { digest, nonce: requestNonce });
    expect(await code(verifyTimestamp(token, flip(digest, 0), anchors))).toBe("imprint_mismatch");
    expect(
      await code(() =>
        parseTimestampResponse(responseDer, { digest: flip(digest, 31), nonce: requestNonce }),
      ),
    ).toBe("imprint_mismatch");
  });

  it("nonce altéré → rejet", async () => {
    expect(
      await code(() =>
        parseTimestampResponse(responseDer, { digest, nonce: flip(requestNonce, 7) }),
      ),
    ).toBe("nonce_mismatch");
  });

  it("politique différente de la politique demandée → rejet", async () => {
    expect(
      await code(() =>
        parseTimestampResponse(responseDer, { digest, nonce: requestNonce, policyOid: "1.2.3.4" }),
      ),
    ).toBe("policy_mismatch");
  });

  it("signature altérée → rejet ; chaîne de confiance inconnue → rejet", async () => {
    const { token } = parseTimestampResponse(responseDer, { digest, nonce: requestNonce });
    // Dernier octet : fin de la valeur de signature du SignerInfo.
    expect(await code(verifyTimestamp(flip(token, token.length - 1), digest, anchors))).toBe(
      "bad_signature",
    );
    expect(await code(verifyTimestamp(token, digest, []))).toBe("untrusted");
    // Date du TSTInfo altérée (« 2026… » → « 2027… ») : l'attribut messageDigest signé ne correspond plus.
    const at = Buffer.from(token).indexOf(Buffer.from("2026", "latin1"));
    const altered = new Uint8Array(token);
    altered[at + 3] = "7".charCodeAt(0);
    expect(await code(verifyTimestamp(altered, digest, anchors))).toBe("bad_signature");
  });

  it("statut « rejection » → erreur typée non réessayable", async () => {
    const rejected = new pkijs.TimeStampResp({
      status: new pkijs.PKIStatusInfo({ status: pkijs.PKIStatus.rejection }),
    });
    const der = new Uint8Array(rejected.toSchema().toBER(false));
    const error = await requestTimestamp(digest, config, anchors, async () => reply(der)).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(TsaError);
    expect(error.code).toBe("rejected");
    expect(error.retryable).toBe(false);
  });
});

describe("appel du prestataire", () => {
  it("n'envoie que la requête (empreinte, nonce) en application/timestamp-query", async () => {
    let sent: Uint8Array | null = null;
    let headers: Record<string, string> = {};
    await requestTimestamp(
      digest,
      { ...config, auth: { type: "basic", user: "u", pass: "p" } },
      anchors,
      async (_url, init) => {
        sent = new Uint8Array(init.body as Uint8Array);
        headers = init.headers as Record<string, string>;
        // Rejoue la réponse enregistrée : son nonce ne correspond pas à celui tiré ici.
        return reply(responseDer);
      },
    ).catch(() => undefined);
    expect(headers["Content-Type"]).toBe("application/timestamp-query");
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
    const req = pkijs.TimeStampReq.fromBER(sent!.buffer.slice(0) as ArrayBuffer);
    expect(
      Buffer.from(req.messageImprint.hashedMessage.getValue()).equals(Buffer.from(digest)),
    ).toBe(true);
    expect(req.nonce!.valueBlock.valueHexView.byteLength).toBeGreaterThanOrEqual(7);
  });

  it("délai dépassé, réseau ou HTTP en erreur → erreur typée réessayable ; mauvais type de contenu → rejet", async () => {
    const timeout = await requestTimestamp(digest, config, anchors, async () => {
      throw Object.assign(new Error("délai"), { name: "TimeoutError" });
    }).catch((e) => e);
    expect(timeout).toMatchObject({ code: "timeout", retryable: true });
    const network = await requestTimestamp(digest, config, anchors, async () => {
      throw new TypeError("fetch failed");
    }).catch((e) => e);
    expect(network).toMatchObject({ code: "network", retryable: true });
    const http = await requestTimestamp(digest, config, anchors, async () =>
      reply(new Uint8Array(), { status: 503 }),
    ).catch((e) => e);
    expect(http).toMatchObject({ code: "http", retryable: true });
    expect(
      await code(
        requestTimestamp(digest, config, anchors, async () =>
          reply(responseDer, { type: "text/html" }),
        ),
      ),
    ).toBe("malformed");
    expect(
      await code(
        requestTimestamp(digest, config, anchors, async () => reply(Uint8Array.from([1, 2, 3]))),
      ),
    ).toBe("malformed");
  });
});
