// Magasin de preuves (PL-304, §4.6.2, §4.3.3). `createEvidence` calcule l'empreinte du contenu (JCS, RFC 8785), tire
// un sel de 32 octets, construit l'enveloppe et la feuille de Merkle, chiffre la charge brute avec la clé de
// l'organisation et l'écrit en stockage objet, puis insère la preuve. Unicité (orgId, dedupeKey) : un doublon est
// ignoré sans erreur. Une preuve ne se modifie plus (trigger evidence_guard), hors scellement et effacement.
import { randomBytes, randomUUID } from "node:crypto";
import type { EvidenceSource, CaptureMethod } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import {
  encrypt,
  generateKey,
  masterKeyFromEnv,
  unwrapKey,
  wrapKey,
  type MasterKey,
} from "@/server/crypto/envelope";
import { contentSha256, envelopeOf, evidenceLeafHash, SALT_BYTES } from "@/server/seal/evidence";
import { canonicalize } from "@/server/seal/jcs";
import { createObjectStore, type ObjectStore } from "@/server/storage/object-store";

/** Preuve produite par un normaliseur (PL-305) ou une saisie manuelle (PL-405). */
export interface EvidenceInput {
  kind: string;
  source: EvidenceSource;
  capturedVia: CaptureMethod;
  resourceId?: string | null;
  sourceRef: string;
  sourceUrl?: string | null;
  dedupeKey: string;
  occurredAt: Date;
  summary: string;
  actor?: { login: string; displayName?: string | null } | null;
  /** Charge normalisée et minimisée (liste blanche de champs). */
  payload: Record<string, unknown>;
  /** Charge brute de la source, conservée chiffrée en stockage objet ; jamais en base ni dans les journaux. */
  raw?: unknown;
  declarative?: boolean;
  validUntil?: Date | null;
  createdByUserId?: string | null;
}

export interface EvidenceDependencies {
  store: ObjectStore;
  master: MasterKey;
  now: () => Date;
}

const defaults = (): EvidenceDependencies => ({
  store: createObjectStore(),
  master: masterKeyFromEnv(),
  now: () => new Date(),
});

/** Transaction dans laquelle app.org_id est positionné (job, withOrgTransaction). */
type Tx = Pick<Prisma.TransactionClient, "evidenceItem" | "orgEncryptionKey">;

/** Clé de données de l'organisation, créée à la première preuve chiffrée. */
export async function orgDataKey(tx: Tx, orgId: string, master: MasterKey): Promise<Buffer> {
  const existing = await tx.orgEncryptionKey.findUnique({ where: { orgId } });
  if (existing) return unwrapKey(master, existing.wrappedDek, orgId);
  const dek = generateKey();
  await tx.orgEncryptionKey.create({
    data: { orgId, wrappedDek: new Uint8Array(wrapKey(master, dek, orgId)), kekId: master.id },
  });
  return dek;
}

export const rawObjectKey = (orgId: string, evidenceId: string) =>
  `orgs/${orgId}/raw/${evidenceId}.bin`;

export type CreateEvidenceResult = { id: string; created: true } | { id: string; created: false };

export async function createEvidence(
  tx: Tx,
  orgId: string,
  input: EvidenceInput,
  deps: EvidenceDependencies = defaults(),
): Promise<CreateEvidenceResult> {
  const duplicate = await tx.evidenceItem.findUnique({
    where: { orgId_dedupeKey: { orgId, dedupeKey: input.dedupeKey } },
    select: { id: true },
  });
  if (duplicate) return { id: duplicate.id, created: false };

  const id = `ev_${randomUUID().replaceAll("-", "")}`;
  const capturedAt = deps.now();
  const content = contentSha256(input.payload);
  const salt = randomBytes(SALT_BYTES);
  const envelope = envelopeOf({
    orgId,
    id,
    kind: input.kind,
    sourceRef: input.sourceRef,
    occurredAt: input.occurredAt,
    capturedAt,
    contentSha256: content,
    attachmentSha256: null,
  });

  let rawKey: string | null = null;
  if (input.raw !== undefined) {
    const dek = await orgDataKey(tx, orgId, deps.master);
    rawKey = rawObjectKey(orgId, id);
    const plaintext = Buffer.from(JSON.stringify(input.raw), "utf8");
    await deps.store.put(rawKey, encrypt(dek, plaintext, `raw:${orgId}:${id}`));
  }

  await tx.evidenceItem.create({
    data: {
      id,
      orgId,
      kind: input.kind,
      source: input.source,
      capturedVia: input.capturedVia,
      resourceId: input.resourceId ?? null,
      sourceRef: input.sourceRef,
      sourceUrl: input.sourceUrl ?? null,
      dedupeKey: input.dedupeKey,
      occurredAt: input.occurredAt,
      capturedAt,
      summary: input.summary,
      actor: (input.actor ?? undefined) as Prisma.InputJsonValue | undefined,
      // La charge stockée est exactement celle qui a été canonicalisée.
      payload: JSON.parse(canonicalize(input.payload)) as Prisma.InputJsonValue,
      contentSha256: new Uint8Array(content),
      salt: new Uint8Array(salt),
      leafHash: new Uint8Array(evidenceLeafHash(salt, envelope)),
      rawObjectKey: rawKey,
      declarative: input.declarative ?? false,
      validUntil: input.validUntil ?? null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return { id, created: true };
}
