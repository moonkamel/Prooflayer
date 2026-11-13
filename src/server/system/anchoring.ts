// Ancrage global (PL-502, §4.6.2 étape 3) : toutes les 6 heures et à la demande (export d'un pack, PL-504), racine
// de Merkle sur les batchHash des lots sans ancre (toutes organisations), anchorHash chaîné à l'ancre précédente,
// horodatage RFC 3161, puis écriture de l'ancre et rattachement des lots dans la même transaction. Le prestataire ne
// reçoit que l'anchorHash. En cas d'échec, rien n'est écrit : les lots restent en attente et passent dans l'ancre
// suivante (aucun lot perdu) ; le job est rejoué, et une alerte part si un lot attend depuis plus de 8 heures.
// Code système : les lots sont lus et rattachés par les fonctions SQL pending_batches_for_anchor et
// attach_batches_to_anchor (RLS), l'ancre est une table commune.
import type { Prisma } from "@/generated/prisma/client";
import {
  anchorHash,
  anchorHeader,
  anchorOverdue,
  sortBatchesForAnchor,
  type AnchorHeader,
} from "@/server/seal/anchor";
import { ZERO_HASH } from "@/server/seal/batch";
import { requestTimestamp, type TimestampResult } from "@/server/seal/tsa";
import { tsaSetup } from "@/server/seal/tsa-config";
import { raiseOperationalAlert } from "./alerts";

/** Lots au plus par ancre. */
export const ANCHOR_MAX_BATCHES = 10_000;

export interface Timestamper {
  name: string;
  timestamp(digest: Uint8Array): Promise<TimestampResult>;
}

export function defaultTimestamper(): Timestamper {
  const setup = tsaSetup();
  return {
    name: setup.config.name,
    timestamp: (digest) => requestTimestamp(digest, setup.config, setup.trustAnchors),
  };
}

export interface AnchorOutcome {
  id: string;
  seq: number;
  batchCount: number;
  anchorHash: string;
  header: AnchorHeader;
}

interface PendingBatch {
  id: string;
  batchHash: Uint8Array;
  sealedAt: Date;
}

/** Lots en attente d'ancre, les plus anciens d'abord. */
export function pendingBatches(tx: Prisma.TransactionClient, limit = ANCHOR_MAX_BATCHES) {
  return tx.$queryRaw<PendingBatch[]>`SELECT * FROM pending_batches_for_anchor(${limit}::int)`;
}

export async function anchorPendingBatches(
  tx: Prisma.TransactionClient,
  now: Date,
  timestamper: Timestamper,
): Promise<AnchorOutcome | null> {
  // Une ancre à la fois : `seq` et prevAnchorHash restent continus.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('seal:anchor', 0))`;
  const pending = await pendingBatches(tx);
  if (pending.length === 0) return null;
  const batches = sortBatchesForAnchor(pending);
  const previous = await tx.anchor.findFirst({
    orderBy: { seq: "desc" },
    select: { seq: true, anchorHash: true },
  });
  const header = anchorHeader({
    seq: (previous?.seq ?? 0) + 1,
    batchHashes: batches.map((b) => b.batchHash),
    prevAnchorHash: previous ? previous.anchorHash : ZERO_HASH,
  });
  const hash = anchorHash(header);
  let stamp: TimestampResult;
  try {
    stamp = await timestamper.timestamp(hash);
  } catch (error) {
    const oldest = pending.reduce<Date | null>(
      (min, b) => (min === null || b.sealedAt < min ? b.sealedAt : min),
      null,
    );
    if (anchorOverdue(oldest, now)) {
      raiseOperationalAlert("seal.anchorOverdue", {
        pendingBatches: pending.length,
        oldestSealedAt: oldest?.toISOString() ?? null,
        tsa: timestamper.name,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    throw error;
  }
  const anchor = await tx.anchor.create({
    data: {
      seq: header.seq,
      batchCount: header.batchCount,
      merkleRoot: new Uint8Array(Buffer.from(header.merkleRoot, "hex")),
      prevAnchorHash: new Uint8Array(Buffer.from(header.prevAnchorHash, "hex")),
      anchorHash: new Uint8Array(hash),
      tsaName: timestamper.name,
      tsaPolicyOid: stamp.policyOid,
      tsaToken: new Uint8Array(stamp.token),
      tsaGenTime: stamp.genTime,
    },
    select: { id: true },
  });
  const ids = batches.map((b) => b.id);
  const indexes = batches.map((_, i) => i);
  const [row] = await tx.$queryRaw<{ attached: number }[]>`
    SELECT attach_batches_to_anchor(${anchor.id}, ${ids}::text[], ${indexes}::int[]) AS attached`;
  // Sous le verrou, aucun lot lu n'a pu être ancré ailleurs : un écart annule l'ancre.
  if (row?.attached !== batches.length) throw new Error("ancrage incomplet : ancre annulée");
  return {
    id: anchor.id,
    seq: header.seq,
    batchCount: header.batchCount,
    anchorHash: hash.toString("hex"),
    header,
  };
}

/** Lots en retard d'ancrage (prestataire en échec depuis plus de 2 heures au-delà de l'intervalle) : alerte. */
export async function checkAnchorBacklog(tx: Prisma.TransactionClient, now: Date) {
  const [oldest] = await pendingBatches(tx, 1);
  const overdue = anchorOverdue(oldest?.sealedAt ?? null, now);
  if (overdue) {
    raiseOperationalAlert("seal.anchorOverdue", {
      oldestSealedAt: oldest!.sealedAt.toISOString(),
    });
  }
  return { overdue, oldestSealedAt: oldest?.sealedAt.toISOString() ?? null };
}
