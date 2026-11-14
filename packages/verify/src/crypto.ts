// Primitives de la vérification : SHA-256, JCS (RFC 8785), arbre de Merkle (RFC 6962), Ed25519. WebCrypto seulement
// (Node 20 et plus, navigateurs récents) : le même code sert à la ligne de commande et à la page publique de
// vérification, sans module propre à Node.

const subtle = () => {
  const c = globalThis.crypto?.subtle;
  if (!c) throw new Error("WebCrypto indisponible");
  return c;
};

const encoder = new TextEncoder();

export const utf8 = (text: string): Uint8Array => encoder.encode(text);

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Hexadécimal minuscule de longueur paire, sinon null (une empreinte mal formée est une altération). */
export function fromHex(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{2})*$/u.test(value)) return null;
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(value.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function fromBase64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 !== 0) return null;
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const buffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

export async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-256", buffer(concat(...parts))));
}

/** Canonicalisation JSON (RFC 8785) : clés triées par unités de code UTF-16, nombres et chaînes comme ECMAScript. */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("JCS : nombre non fini");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
      const keys = Object.keys(value).sort();
      return `{${keys
        .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`)
        .join(",")}}`;
    }
    default:
      throw new TypeError(`JCS : type non représentable (${typeof value})`);
  }
}

const LEAF = Uint8Array.of(0x00);
const NODE = Uint8Array.of(0x01);

/** leafHash = SHA-256(0x00 ‖ sel ‖ JCS(enveloppe)) (§4.6.2 étape 1). */
export const leafHash = (salt: Uint8Array, envelope: unknown) =>
  sha256(LEAF, salt, utf8(canonicalize(envelope)));

/** Plus grande puissance de 2 strictement inférieure à n (n >= 2). */
const split = (n: number) => {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
};

/** Racine de Merkle (RFC 6962 §2.1) sur des feuilles déjà hachées. */
export async function merkleRoot(leaves: readonly Uint8Array[]): Promise<Uint8Array> {
  if (leaves.length === 0) return sha256();
  if (leaves.length === 1) return leaves[0]!;
  const k = split(leaves.length);
  return sha256(NODE, await merkleRoot(leaves.slice(0, k)), await merkleRoot(leaves.slice(k)));
}

/** Empreinte d'un en-tête : SHA-256(JCS(en-tête)). */
export const headerHash = (header: unknown) => sha256(utf8(canonicalize(header)));

/** Signature Ed25519 (WebCrypto) d'octets donnés, contre une clé publique brute de 32 octets. */
export async function verifyEd25519(
  publicKey: Uint8Array,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  try {
    const key = await subtle().importKey("raw", buffer(publicKey), { name: "Ed25519" }, false, [
      "verify",
    ]);
    return await subtle().verify({ name: "Ed25519" }, key, buffer(signature), buffer(data));
  } catch {
    return false;
  }
}
