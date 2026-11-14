// Signature des packs (PL-504, §4.6.5) : Ed25519, identifiant `pl-AAAA-MM`. Le manifeste est signé sur son JCS
// (RFC 8785), sans le champ `signature`. Production : clé privée dans `PACK_SIGNING_KEY` (PKCS#8, PEM ou DER en base64,
// variable « sensitive » Vercel) et identifiant dans `PACK_SIGNING_KID` ; sans elles, la production refuse de signer.
// Hors production : clé de développement dérivée de BETTER_AUTH_SECRET (identifiant `pl-dev`), jamais publiée en
// production. Clés publiques : table `SigningKey`, servies par `/.well-known/prooflayer-keys.json`.
import {
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import { canonicalize } from "@/server/seal/jcs";

export const DEV_KID = "pl-dev";
const KID_PATTERN = /^pl-\d{4}-\d{2}$/u;
/** En-tête DER PKCS#8 d'une clé privée Ed25519 dont la graine de 32 octets suit. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export interface PackSigningKey {
  kid: string;
  privateKey: KeyObject;
  /** Clé publique brute, 32 octets. */
  publicKey: Buffer;
}

export class SigningKeyNotConfiguredError extends Error {
  constructor() {
    super("clé de signature des packs absente en production (PACK_SIGNING_KEY, PACK_SIGNING_KID)");
    this.name = "SigningKeyNotConfiguredError";
  }
}

/** Clé publique brute (32 octets) d'une clé Ed25519. */
export function rawPublicKey(key: KeyObject): Buffer {
  const jwk = createPublicKey(key).export({ format: "jwk" });
  return Buffer.from(jwk.x as string, "base64url");
}

export function privateKeyFromSeed(seed: Uint8Array): KeyObject {
  if (seed.length !== 32) throw new RangeError("une graine Ed25519 fait 32 octets");
  return createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]),
    format: "der",
    type: "pkcs8",
  });
}

type Env = Record<string, string | undefined>;

export function packSigningKey(env: Env = process.env): PackSigningKey {
  if (env.PACK_SIGNING_KEY) {
    const kid = env.PACK_SIGNING_KID ?? "";
    if (!KID_PATTERN.test(kid)) throw new SigningKeyNotConfiguredError();
    const value = env.PACK_SIGNING_KEY.trim();
    const privateKey = value.startsWith("-----BEGIN")
      ? createPrivateKey(value)
      : createPrivateKey({ key: Buffer.from(value, "base64"), format: "der", type: "pkcs8" });
    if (privateKey.asymmetricKeyType !== "ed25519") throw new SigningKeyNotConfiguredError();
    return { kid, privateKey, publicKey: rawPublicKey(privateKey) };
  }
  if (env.VERCEL_ENV === "production") throw new SigningKeyNotConfiguredError();
  const secret = env.BETTER_AUTH_SECRET ?? "prooflayer-dev-secret";
  const seed = Buffer.from(hkdfSync("sha256", secret, "prooflayer", "pack-signing-dev", 32));
  const privateKey = privateKeyFromSeed(seed);
  return { kid: DEV_KID, privateKey, publicKey: rawPublicKey(privateKey) };
}

export interface ManifestSignature {
  alg: "Ed25519";
  kid: string;
  /** Signature en base64 du JCS du manifeste privé de ce champ. */
  value: string;
}

/** Octets signés : JCS du manifeste sans son champ `signature`. */
export function signedBytes(manifest: Record<string, unknown>): Buffer {
  const { signature: _ignored, ...rest } = manifest;
  void _ignored;
  return Buffer.from(canonicalize(rest), "utf8");
}

export function signManifest<T extends Record<string, unknown>>(
  manifest: T,
  key: PackSigningKey,
): T & { signature: ManifestSignature } {
  const value = edSign(null, signedBytes(manifest), key.privateKey).toString("base64");
  return { ...manifest, signature: { alg: "Ed25519", kid: key.kid, value } };
}

/** Vérifie la signature d'un manifeste contre des clés publiques brutes indexées par identifiant. */
export function verifyManifestSignature(
  manifest: Record<string, unknown> & { signature?: Partial<ManifestSignature> },
  publicKeys: ReadonlyMap<string, Uint8Array>,
): boolean {
  const sig = manifest.signature;
  if (
    !sig ||
    sig.alg !== "Ed25519" ||
    typeof sig.kid !== "string" ||
    typeof sig.value !== "string"
  ) {
    return false;
  }
  const raw = publicKeys.get(sig.kid);
  if (!raw || raw.length !== 32) return false;
  const key = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") },
    format: "jwk",
  });
  try {
    return edVerify(null, signedBytes(manifest), key, Buffer.from(sig.value, "base64"));
  } catch {
    return false;
  }
}
