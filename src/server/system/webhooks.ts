// Boîte de réception des webhooks (PL-302, §4.5.1) : table système `WebhookDelivery`, sans organisation. Idempotence
// au niveau de la livraison : la contrainte unique (provider, deliveryId) absorbe les rejeux du fournisseur.
// Réessais (§4.5.3) : 8 tentatives, attente exponentielle avec aléa ; au-delà, FAILED.
import { createHash } from "node:crypto";
import type { IntegrationProvider } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { MAX_ATTEMPTS, retryDelayMs } from "./jobs/backoff";

/** Au-delà, une livraison restée PROCESSING (worker interrompu) est reprise. */
export const DELIVERY_LEASE_MS = 5 * 60_000;

/** Enregistre une livraison ; renvoie vrai si elle est nouvelle (faux pour un rejeu). */
export async function recordDelivery(input: {
  provider: IntegrationProvider;
  deliveryId: string;
  eventType: string;
  externalAccountId: string;
  payload: unknown;
  rawBody: Uint8Array;
}): Promise<boolean> {
  const { count } = await prisma.webhookDelivery.createMany({
    data: [
      {
        provider: input.provider,
        deliveryId: input.deliveryId,
        eventType: input.eventType,
        externalAccountId: input.externalAccountId,
        payload: input.payload as Prisma.InputJsonValue,
        payloadSha256: createHash("sha256").update(input.rawBody).digest("hex"),
      },
    ],
    skipDuplicates: true,
  });
  return count === 1;
}

export interface ClaimedDelivery {
  id: string;
  provider: IntegrationProvider;
  deliveryId: string;
  eventType: string;
  externalAccountId: string;
  payload: unknown;
  attempts: number;
  claimedAt: Date;
}

/**
 * Prend une livraison à traiter (PENDING arrivée à échéance, ou PROCESSING abandonnée) et la passe PROCESSING.
 * `FOR UPDATE SKIP LOCKED` : deux workers ne prennent jamais la même.
 */
export async function claimDeliveries(
  limit: number,
  only?: { provider: IntegrationProvider; deliveryId: string },
): Promise<ClaimedDelivery[]> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - DELIVERY_LEASE_MS);
  return prisma.$queryRaw<ClaimedDelivery[]>`
    UPDATE "WebhookDelivery" SET status = 'PROCESSING', attempts = attempts + 1, "nextAttemptAt" = ${now}
    WHERE id IN (
      SELECT id FROM "WebhookDelivery"
      WHERE ((status = 'PENDING' AND "nextAttemptAt" <= ${now})
             OR (status = 'PROCESSING' AND "nextAttemptAt" <= ${staleBefore}))
        AND (${only?.deliveryId ?? null}::text IS NULL
             OR (provider = ${only?.provider ?? null}::"IntegrationProvider" AND "deliveryId" = ${only?.deliveryId ?? null}))
      ORDER BY "receivedAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, provider, "deliveryId", "eventType", "externalAccountId", payload, attempts,
              "nextAttemptAt" AS "claimedAt"`;
}

type Client = Pick<Prisma.TransactionClient, "webhookDelivery">;

/** Fin d'une livraison prise à `claimedAt` ; sans effet si un autre worker l'a reprise entre-temps. */
export async function finishDelivery(
  delivery: Pick<ClaimedDelivery, "id" | "claimedAt">,
  status: "PROCESSED" | "IGNORED",
  client: Client = prisma,
  reason?: string,
): Promise<boolean> {
  const { count } = await client.webhookDelivery.updateMany({
    where: { id: delivery.id, status: "PROCESSING", nextAttemptAt: delivery.claimedAt },
    data: { status, processedAt: new Date(), lastError: reason ?? null },
  });
  return count === 1;
}

/** Échec d'une tentative : nouvel essai planifié, ou FAILED après la huitième. Message sans charge. */
export async function failDelivery(
  delivery: ClaimedDelivery,
  message: string,
): Promise<"retry" | "failed"> {
  const failed = delivery.attempts >= MAX_ATTEMPTS;
  await prisma.webhookDelivery.updateMany({
    where: { id: delivery.id, status: "PROCESSING", nextAttemptAt: delivery.claimedAt },
    data: {
      status: failed ? "FAILED" : "PENDING",
      nextAttemptAt: new Date(Date.now() + retryDelayMs(delivery.attempts)),
      lastError: message.slice(0, 500),
    },
  });
  return failed ? "failed" : "retry";
}

/** Organisation qui a lié ce compte externe (fonction SQL `resolve_integration`, seule lecture hors RLS). */
export async function resolveIntegration(provider: IntegrationProvider, externalAccountId: string) {
  const rows = await prisma.$queryRaw<{ integrationId: string; orgId: string; status: string }[]>`
    SELECT * FROM resolve_integration(${provider}::"IntegrationProvider", ${externalAccountId})`;
  return rows[0] ?? null;
}
