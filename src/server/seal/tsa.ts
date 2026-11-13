// Client d'horodatage RFC 3161 (PL-502, prompt-type du §9.7, §4.6.2 étape 3). Seule l'empreinte de 32 octets quitte
// le serveur. `requestTimestamp` construit la requête (version 1, SHA-256, nonce de 8 octets, certReq), l'envoie et
// vérifie la réponse ; `verifyTimestamp` revérifie un jeton stocké sans aucun appel réseau, contre des certificats de
// confiance fournis (chaîne du prestataire).
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { randomBytes, webcrypto } from "node:crypto";

pkijs.setEngine("node", new pkijs.CryptoEngine({ name: "node", crypto: webcrypto as Crypto }));

const SHA256_OID = "2.16.840.1.101.3.4.2.1";
const ID_KP_TIMESTAMPING = "1.3.6.1.5.5.7.3.8";
const EXT_KEY_USAGE_OID = "2.5.29.37";
const TST_INFO_OID = "1.2.840.113549.1.9.16.1.4";
const ID_DATA = "1.2.840.113549.1.7.1";
const CONTENT_TYPE_ATTR = "1.2.840.113549.1.9.3";

export interface TsaConfig {
  name: string;
  url: string;
  policyOid?: string;
  auth?: { type: "basic"; user: string; pass: string };
  timeoutMs: number;
}

export interface TimestampResult {
  /** TimeStampToken DER (ContentInfo / SignedData). */
  token: Uint8Array;
  genTime: Date;
  serial: string;
  policyOid: string;
}

export interface VerifiedTimestamp {
  genTime: Date;
  serial: string;
  policyOid: string;
  signer: string;
}

export type TsaErrorCode =
  | "timeout"
  | "network"
  | "http"
  | "rejected"
  | "malformed"
  | "imprint_mismatch"
  | "nonce_mismatch"
  | "policy_mismatch"
  | "bad_signature"
  | "untrusted"
  | "not_timestamping_cert";

/** Erreur typée ; `retryable` dit si un nouvel essai a un sens (panne passagère du prestataire). */
export class TsaError extends Error {
  constructor(
    readonly code: TsaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TsaError";
  }
  get retryable() {
    return this.code === "timeout" || this.code === "network" || this.code === "http";
  }
}

const buf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("hex");

function assertDigest(digest: Uint8Array) {
  if (digest.length !== 32) throw new RangeError("l'empreinte SHA-256 fait 32 octets");
}

/** Requête RFC 3161 (§2.4.1) : version 1, empreinte SHA-256, nonce, certReq. */
export function buildTimestampRequest(digest: Uint8Array, nonce: Uint8Array, policyOid?: string) {
  assertDigest(digest);
  const request = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: SHA256_OID }),
      hashedMessage: new asn1js.OctetString({ valueHex: buf(digest) }),
    }),
    nonce: new asn1js.Integer({ valueHex: buf(nonce) }),
    certReq: true,
    ...(policyOid ? { reqPolicy: policyOid } : {}),
  });
  return new Uint8Array(request.toSchema().toBER(false));
}

/** Lit un TimeStampToken et son TSTInfo, sans rien vérifier. */
function parseToken(token: Uint8Array) {
  const asn = asn1js.fromBER(buf(token));
  if (asn.offset === -1) throw new TsaError("malformed", "jeton illisible");
  let content: pkijs.ContentInfo;
  let signed: pkijs.SignedData;
  let tst: pkijs.TSTInfo;
  try {
    content = new pkijs.ContentInfo({ schema: asn.result });
    if (content.contentType !== pkijs.ContentInfo.SIGNED_DATA) throw new Error("pas un SignedData");
    signed = new pkijs.SignedData({ schema: content.content });
    if (signed.encapContentInfo.eContentType !== TST_INFO_OID) throw new Error("pas un TSTInfo");
    const eContent = signed.encapContentInfo.eContent;
    if (!eContent) throw new Error("TSTInfo absent");
    tst = pkijs.TSTInfo.fromBER(eContent.getValue());
  } catch {
    throw new TsaError("malformed", "jeton RFC 3161 invalide");
  }
  return { signed, tst };
}

function checkImprint(tst: pkijs.TSTInfo, digest: Uint8Array) {
  const imprint = tst.messageImprint;
  if (
    imprint.hashAlgorithm.algorithmId !== SHA256_OID ||
    hex(imprint.hashedMessage.getValue()) !== hex(digest)
  ) {
    throw new TsaError("imprint_mismatch", "l'empreinte horodatée n'est pas celle envoyée");
  }
}

/** Un seul signataire, dont l'attribut signé contentType désigne un TSTInfo (RFC 3161 §2.4.2, RFC 5652 §11.1). */
function checkSignedContentType(signed: pkijs.SignedData) {
  const signer = signed.signerInfos.length === 1 ? signed.signerInfos[0] : undefined;
  const attribute = signer?.signedAttrs?.attributes.find((a) => a.type === CONTENT_TYPE_ATTR);
  const value = attribute?.values[0] as asn1js.ObjectIdentifier | undefined;
  if (value?.valueBlock.toString() !== TST_INFO_OID) {
    throw new TsaError("malformed", "jeton sans signataire unique d'un TSTInfo");
  }
}

/** Le certificat signataire porte l'usage étendu id-kp-timeStamping (RFC 3161 §2.3). */
function checkTimestampingUsage(cert: pkijs.Certificate) {
  const eku = cert.extensions?.find((e) => e.extnID === EXT_KEY_USAGE_OID);
  const usages = (eku?.parsedValue as pkijs.ExtKeyUsage | undefined)?.keyPurposes ?? [];
  if (!usages.includes(ID_KP_TIMESTAMPING)) {
    throw new TsaError("not_timestamping_cert", "certificat signataire sans usage d'horodatage");
  }
}

/**
 * Vérifie un jeton sans réseau : empreinte, signature CMS, chaîne jusqu'à un certificat de confiance (à la date du
 * jeton), usage d'horodatage du signataire.
 */
export async function verifyTimestamp(
  token: Uint8Array,
  digest: Uint8Array,
  trustAnchors: pkijs.Certificate[],
): Promise<VerifiedTimestamp> {
  assertDigest(digest);
  const { signed, tst } = parseToken(token);
  checkImprint(tst, digest);
  checkSignedContentType(signed);
  // pkijs, pour un TSTInfo, réclame les données d'origine (dont nous n'avons que l'empreinte, l'anchorHash). On vérifie
  // donc l'empreinte nous-mêmes (ci-dessus), et on lui fait vérifier le reste comme pour un contenu ordinaire :
  // messageDigest des attributs signés sur le TSTInfo, signature de ces attributs, chaîne de certificats. Ni l'une ni
  // l'autre ne dépend du champ eContentType, que l'attribut signé contentType fixe (vérifié ci-dessus).
  signed.encapContentInfo.eContentType = ID_DATA;
  let result: pkijs.SignedDataVerifyResult;
  try {
    result = await signed.verify({
      signer: 0,
      trustedCerts: trustAnchors,
      checkChain: true,
      checkDate: tst.genTime,
      extendedMode: true,
    });
  } catch (error) {
    // Codes de pkijs : 3 signataire introuvable, 5 chaîne invalide ; les autres (empreinte des attributs signés,
    // signature) disent un jeton altéré.
    const code = (error as Partial<pkijs.SignedDataVerifyResult>).code;
    if (code === 3 || code === 5)
      throw new TsaError("untrusted", "chaîne du prestataire non reconnue");
    throw new TsaError("bad_signature", "signature du jeton invalide");
  }
  if (!result.signatureVerified) throw new TsaError("bad_signature", "signature du jeton invalide");
  if (!result.signerCertificateVerified || !result.signerCertificate) {
    throw new TsaError("untrusted", "chaîne du prestataire non reconnue");
  }
  checkTimestampingUsage(result.signerCertificate);
  return {
    genTime: tst.genTime,
    serial: hex(tst.serialNumber.valueBlock.valueHexView),
    policyOid: tst.policy,
    signer: result.signerCertificate.subject.typesAndValues
      .map((t) => `${t.type}=${t.value.valueBlock.value}`)
      .join(","),
  };
}

/**
 * Lit une réponse RFC 3161 (§2.4.2) : statut accordé, empreinte et nonce identiques à la requête, politique demandée.
 * La signature et la chaîne sont vérifiées par `verifyTimestamp`.
 */
export function parseTimestampResponse(
  response: Uint8Array,
  expected: { digest: Uint8Array; nonce: Uint8Array; policyOid?: string },
): { token: Uint8Array; tst: pkijs.TSTInfo } {
  let resp: pkijs.TimeStampResp;
  try {
    resp = pkijs.TimeStampResp.fromBER(buf(response));
  } catch {
    throw new TsaError("malformed", "réponse RFC 3161 illisible");
  }
  const status = resp.status.status;
  if (status !== pkijs.PKIStatus.granted && status !== pkijs.PKIStatus.grantedWithMods) {
    throw new TsaError("rejected", `horodatage refusé (statut ${status})`);
  }
  if (!resp.timeStampToken) throw new TsaError("malformed", "réponse sans jeton");
  const token = new Uint8Array(resp.timeStampToken.toSchema().toBER(false));
  const { tst } = parseToken(token);
  checkImprint(tst, expected.digest);
  const nonce = tst.nonce ? hex(tst.nonce.valueBlock.valueHexView) : null;
  // Un entier ASN.1 positif peut porter un octet nul de tête : on compare sans les zéros de tête.
  const strip = (h: string) => h.replace(/^(00)+/u, "");
  if (!nonce || strip(nonce) !== strip(hex(expected.nonce))) {
    throw new TsaError("nonce_mismatch", "nonce de la réponse différent de la requête");
  }
  if (expected.policyOid && tst.policy !== expected.policyOid) {
    throw new TsaError(
      "policy_mismatch",
      "politique d'horodatage différente de la politique demandée",
    );
  }
  return { token, tst };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Horodate une empreinte auprès du prestataire et vérifie la réponse (statut, empreinte, nonce, signature, chaîne). */
export async function requestTimestamp(
  digest: Uint8Array,
  tsa: TsaConfig,
  trustAnchors: pkijs.Certificate[],
  fetchImpl: FetchLike = fetch,
): Promise<TimestampResult> {
  assertDigest(digest);
  const nonce = randomBytes(8);
  // Entier positif : bit de poids fort à zéro.
  nonce[0] = nonce[0]! & 0x7f;
  const body = buildTimestampRequest(digest, nonce, tsa.policyOid);
  const headers: Record<string, string> = { "Content-Type": "application/timestamp-query" };
  if (tsa.auth) {
    headers.Authorization = `Basic ${Buffer.from(`${tsa.auth.user}:${tsa.auth.pass}`).toString("base64")}`;
  }
  let response: Response;
  try {
    response = await fetchImpl(tsa.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(tsa.timeoutMs),
    });
  } catch (error) {
    const name = (error as Error).name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new TsaError("timeout", `prestataire ${tsa.name} : délai dépassé`);
    }
    throw new TsaError("network", `prestataire ${tsa.name} injoignable`);
  }
  if (!response.ok) throw new TsaError("http", `prestataire ${tsa.name} : HTTP ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/timestamp-reply")) {
    throw new TsaError("malformed", `prestataire ${tsa.name} : type de réponse inattendu`);
  }
  const { token, tst } = parseTimestampResponse(new Uint8Array(await response.arrayBuffer()), {
    digest,
    nonce,
    policyOid: tsa.policyOid,
  });
  await verifyTimestamp(token, digest, trustAnchors);
  return {
    token,
    genTime: tst.genTime,
    serial: hex(tst.serialNumber.valueBlock.valueHexView),
    policyOid: tst.policy,
  };
}

/** Certificats de confiance au format PEM (un ou plusieurs blocs). */
export function certificatesFromPem(pem: string): pkijs.Certificate[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu) ?? [];
  return blocks.map((block) => {
    const der = Buffer.from(block.replace(/-----[A-Z ]+-----|\s/gu, ""), "base64");
    return pkijs.Certificate.fromBER(buf(new Uint8Array(der)));
  });
}
