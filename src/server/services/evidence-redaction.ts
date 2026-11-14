// Effacement d'une preuve (PL-507, §4.6.5, droit à l'effacement) : charge, acteur et sel mis à NULL, charge brute et
// pièce jointe supprimées du stockage objet. Le leafHash et l'enveloppe scellée (empreintes, dates, type) demeurent :
// le lot, l'ancre et les autres preuves se vérifient toujours ; sans le sel, l'empreinte ne peut plus être rapprochée
// d'un contenu deviné. Irréversible, réservé à l'administrateur, journalisé sans aucun contenu.
import { Prisma } from "@/generated/prisma/client";
import { withOrgTransaction } from "@/server/db";
import { createObjectStore, type ObjectStore } from "@/server/storage/object-store";
import { audit, clientIp } from "./audit";
import { ServiceError } from "./errors";
import type { OrgContext } from "./organization";

/** Motif de l'effacement : une liste fermée, jamais de texte libre (il porterait la donnée personnelle à effacer). */
export const REDACTION_REASONS = ["data_subject_request", "data_minimisation", "other"] as const;
export type RedactionReason = (typeof REDACTION_REASONS)[number];

export const redactionStorage = { store: (): ObjectStore => createObjectStore() };

export async function redactEvidence(
  ctx: OrgContext,
  input: { evidenceId: string; reason: RedactionReason },
  deps: { store: ObjectStore; now: () => Date } = {
    store: redactionStorage.store(),
    now: () => new Date(),
  },
): Promise<{ evidenceId: string; redactedAt: string }> {
  const now = deps.now();
  const removed = await withOrgTransaction(ctx.orgId, async (tx) => {
    const rows = await tx.$queryRaw<
      {
        id: string;
        redactedAt: Date | null;
        rawObjectKey: string | null;
        attachmentKey: string | null;
      }[]
    >`SELECT id, "redactedAt", "rawObjectKey", "attachmentKey" FROM "EvidenceItem"
      WHERE id = ${input.evidenceId} AND "orgId" = ${ctx.orgId} FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new ServiceError("NOT_FOUND", "evidence.notFound");
    if (row.redactedAt) throw new ServiceError("CONFLICT", "evidence.alreadyRedacted");
    // Fichiers supprimés d'abord (suppression idempotente) : si l'écriture échoue ensuite, un nouvel effacement
    // reprend sans jamais laisser de fichier orphelin portant la donnée effacée.
    for (const key of [row.rawObjectKey, row.attachmentKey]) {
      if (key) await deps.store.delete(key);
    }
    await tx.evidenceItem.update({
      where: { id: row.id },
      data: {
        payload: Prisma.DbNull,
        actor: Prisma.DbNull,
        salt: null,
        rawObjectKey: null,
        attachmentKey: null,
        redactedAt: now,
      },
    });
    return { raw: row.rawObjectKey !== null, attachment: row.attachmentKey !== null };
  });
  await audit(
    {
      orgId: ctx.orgId,
      actor: { type: "user", id: ctx.userId },
      ipAddress: clientIp(ctx.headers),
      db: ctx.db,
    },
    "evidence.redact",
    { type: "evidence", id: input.evidenceId },
    { reason: input.reason, rawDeleted: removed.raw, attachmentDeleted: removed.attachment },
  );
  return { evidenceId: input.evidenceId, redactedAt: now.toISOString() };
}
