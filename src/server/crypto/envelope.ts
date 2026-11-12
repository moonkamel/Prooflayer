// Chiffrement applicatif en enveloppe (§4.7) : chaque organisation a sa clé de données (DEK, AES-256-GCM), elle-même
// chiffrée par la clé maîtresse (KEK). Détruire la DEK d'une organisation rend ses charges illisibles.
// Format d'un chiffré : version (1 octet, 0x01) ‖ IV (12) ‖ étiquette GCM (16) ‖ données. Les données associées
// (AAD) lient le chiffré à son contexte (organisation, preuve) : un chiffré déplacé ne se déchiffre pas.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const KEY_BYTES = 32;

export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export function encrypt(key: Uint8Array, plaintext: Uint8Array, aad: string): Buffer {
  if (key.length !== KEY_BYTES) throw new RangeError("clé AES-256 attendue");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.of(VERSION), iv, cipher.getAuthTag(), data]);
}

export function decrypt(key: Uint8Array, sealed: Uint8Array, aad: string): Buffer {
  if (key.length !== KEY_BYTES) throw new RangeError("clé AES-256 attendue");
  const bytes = Buffer.from(sealed);
  if (bytes[0] !== VERSION || bytes.length < 1 + IV_BYTES + TAG_BYTES) {
    throw new Error("chiffré illisible");
  }
  const iv = bytes.subarray(1, 1 + IV_BYTES);
  const tag = bytes.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(bytes.subarray(1 + IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]);
}

export interface MasterKey {
  id: string;
  key: Buffer;
}

/**
 * Clé maîtresse lue dans `PROOFLAYER_MASTER_KEY` (32 octets en base64). Au MVP : variable d'environnement sensible ;
 * en V1 : KMS européen (§8.2). L'identifiant dérive de la clé, pour savoir laquelle a chiffré une DEK.
 */
export function masterKeyFromEnv(env: Record<string, string | undefined> = process.env): MasterKey {
  const raw = env.PROOFLAYER_MASTER_KEY;
  if (!raw) throw new Error("PROOFLAYER_MASTER_KEY absente : chiffrement des charges impossible");
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES)
    throw new Error("PROOFLAYER_MASTER_KEY doit faire 32 octets en base64");
  return { id: `env:${createHash("sha256").update(key).digest("hex").slice(0, 12)}`, key };
}

export const wrapKey = (master: MasterKey, dek: Uint8Array, orgId: string) =>
  encrypt(master.key, dek, `dek:${orgId}`);

export const unwrapKey = (master: MasterKey, wrapped: Uint8Array, orgId: string) =>
  decrypt(master.key, wrapped, `dek:${orgId}`);
