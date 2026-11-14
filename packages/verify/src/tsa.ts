// Vérification d'un jeton d'horodatage RFC 3161, sans réseau (§4.6.3 étape 5) : l'empreinte horodatée est
// l'anchorHash, la signature CMS est valide, la chaîne remonte à une racine épinglée (à la date du jeton), le
// signataire porte l'usage id-kp-timeStamping. Les racines jointes au pack ne sont jamais crues : seules celles de
// l'outil (ou passées explicitement) le sont.
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { equalBytes, toHex } from "./crypto.js";

let engineReady = false;
function ensureEngine() {
  if (engineReady) return;
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) throw new Error("WebCrypto indisponible");
  pkijs.setEngine("prooflayer-verify", new pkijs.CryptoEngine({ name: "webcrypto", crypto }));
  engineReady = true;
}

const SHA256_OID = "2.16.840.1.101.3.4.2.1";
const ID_KP_TIMESTAMPING = "1.3.6.1.5.5.7.3.8";
const EXT_KEY_USAGE_OID = "2.5.29.37";
const TST_INFO_OID = "1.2.840.113549.1.9.16.1.4";
const ID_DATA = "1.2.840.113549.1.7.1";
const CONTENT_TYPE_ATTR = "1.2.840.113549.1.9.3";

export type TokenProblem =
  "malformed" | "imprint" | "bad_signature" | "untrusted" | "not_timestamping_cert";

export interface TrustedRoot {
  /** Nom du prestataire, affiché. */
  name: string;
  /** Prestataire qualifié eIDAS (liste de confiance de l'UE). */
  qualified: boolean;
  pem: string;
}

export type TokenCheck =
  | { ok: true; genTime: Date; policyOid: string; serial: string; root: TrustedRoot }
  | { ok: false; problem: TokenProblem };

const buf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

export function certificatesFromPem(pem: string): pkijs.Certificate[] {
  ensureEngine();
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu) ?? [];
  return blocks.map((block) => {
    const body = block.replace(/-----[A-Z ]+-----|\s/gu, "");
    const binary = atob(body);
    const der = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
    return pkijs.Certificate.fromBER(buf(der));
  });
}

function parse(token: Uint8Array) {
  const asn = asn1js.fromBER(buf(token));
  if (asn.offset === -1) return null;
  try {
    const content = new pkijs.ContentInfo({ schema: asn.result });
    if (content.contentType !== pkijs.ContentInfo.SIGNED_DATA) return null;
    const signed = new pkijs.SignedData({ schema: content.content });
    if (signed.encapContentInfo.eContentType !== TST_INFO_OID) return null;
    const eContent = signed.encapContentInfo.eContent;
    if (!eContent) return null;
    return { signed, tst: pkijs.TSTInfo.fromBER(eContent.getValue()) };
  } catch {
    return null;
  }
}

function signsTstInfo(signed: pkijs.SignedData): boolean {
  const signer = signed.signerInfos.length === 1 ? signed.signerInfos[0] : undefined;
  const attribute = signer?.signedAttrs?.attributes.find((a) => a.type === CONTENT_TYPE_ATTR);
  const value = attribute?.values[0] as asn1js.ObjectIdentifier | undefined;
  return value?.valueBlock.toString() === TST_INFO_OID;
}

function hasTimestampingUsage(cert: pkijs.Certificate): boolean {
  const eku = cert.extensions?.find((e) => e.extnID === EXT_KEY_USAGE_OID);
  const usages = (eku?.parsedValue as pkijs.ExtKeyUsage | undefined)?.keyPurposes ?? [];
  return usages.includes(ID_KP_TIMESTAMPING);
}

/** Vérifie un jeton contre une racine. Le jeton est relu à chaque essai (pkijs modifie l'objet vérifié). */
async function againstRoot(token: Uint8Array, root: pkijs.Certificate[]) {
  const parsed = parse(token)!;
  // pkijs réclame, pour un TSTInfo, les données d'origine (nous n'avons que l'empreinte, vérifiée à part) : on lui fait
  // vérifier messageDigest, signature et chaîne comme pour un contenu ordinaire ; l'attribut signé contentType, lui,
  // reste contrôlé (signsTstInfo).
  parsed.signed.encapContentInfo.eContentType = ID_DATA;
  try {
    const result = await parsed.signed.verify({
      signer: 0,
      trustedCerts: root,
      checkChain: true,
      checkDate: parsed.tst.genTime,
      extendedMode: true,
    });
    if (!result.signatureVerified) return "bad_signature" as const;
    if (!result.signerCertificateVerified || !result.signerCertificate) return "untrusted" as const;
    return result.signerCertificate;
  } catch (error) {
    const code = (error as Partial<pkijs.SignedDataVerifyResult>).code;
    return code === 3 || code === 5 ? ("untrusted" as const) : ("bad_signature" as const);
  }
}

export async function verifyToken(
  token: Uint8Array,
  digest: Uint8Array,
  roots: readonly TrustedRoot[],
): Promise<TokenCheck> {
  ensureEngine();
  const parsed = parse(token);
  if (!parsed || !signsTstInfo(parsed.signed)) return { ok: false, problem: "malformed" };
  const imprint = parsed.tst.messageImprint;
  if (
    imprint.hashAlgorithm.algorithmId !== SHA256_OID ||
    !equalBytes(new Uint8Array(imprint.hashedMessage.getValue()), digest)
  ) {
    return { ok: false, problem: "imprint" };
  }
  let problem: TokenProblem = "untrusted";
  for (const root of roots) {
    const outcome = await againstRoot(token, certificatesFromPem(root.pem));
    if (outcome === "bad_signature") return { ok: false, problem: "bad_signature" };
    if (outcome === "untrusted") continue;
    if (!hasTimestampingUsage(outcome)) {
      problem = "not_timestamping_cert";
      continue;
    }
    return {
      ok: true,
      genTime: parsed.tst.genTime,
      policyOid: parsed.tst.policy,
      serial: toHex(new Uint8Array(parsed.tst.serialNumber.valueBlock.valueHexView)),
      root,
    };
  }
  return { ok: false, problem };
}
