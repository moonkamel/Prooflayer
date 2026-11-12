// Empreintes d'une preuve (§4.6.2, étape 1). Fonctions pures.
//   contentSha256 = SHA-256(JCS(payload))
//   leafHash = SHA-256(0x00 ‖ sel ‖ JCS(enveloppe)), enveloppe = { v, org, id, kind, sourceRef, occurredAt,
//   capturedAt, contentSha256, attachmentSha256 }.
// Encodage retenu dans l'enveloppe (le cahier ne le fixe pas) : empreintes en hexadécimal minuscule, dates en ISO 8601
// UTC à la milliseconde. L'outil de vérification (PL-505) reprend exactement cette convention.
import { createHash } from "node:crypto";
import { canonicalize } from "./jcs";
import { leafHash } from "./merkle";

export const ENVELOPE_VERSION = 1;
export const SALT_BYTES = 32;

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest();

export function contentSha256(payload: unknown): Buffer {
  return sha256(canonicalize(payload));
}

export interface EnvelopeInput {
  orgId: string;
  id: string;
  kind: string;
  sourceRef: string;
  occurredAt: Date;
  capturedAt: Date;
  contentSha256: Uint8Array;
  attachmentSha256: Uint8Array | null;
}

export interface Envelope {
  v: number;
  org: string;
  id: string;
  kind: string;
  sourceRef: string;
  occurredAt: string;
  capturedAt: string;
  contentSha256: string;
  attachmentSha256: string | null;
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

export function envelopeOf(input: EnvelopeInput): Envelope {
  return {
    v: ENVELOPE_VERSION,
    org: input.orgId,
    id: input.id,
    kind: input.kind,
    sourceRef: input.sourceRef,
    occurredAt: input.occurredAt.toISOString(),
    capturedAt: input.capturedAt.toISOString(),
    contentSha256: hex(input.contentSha256),
    attachmentSha256: input.attachmentSha256 ? hex(input.attachmentSha256) : null,
  };
}

export function evidenceLeafHash(salt: Uint8Array, envelope: Envelope): Buffer {
  if (salt.length !== SALT_BYTES) throw new RangeError("le sel fait 32 octets");
  return leafHash(salt, Buffer.from(canonicalize(envelope), "utf8"));
}
