// Traitement d'une livraison de webhook (PL-302, diagramme du §4.5.1) : installation → organisation, dépôt → ressource
// liée, normalisation et minimisation, charge brute chiffrée, preuves insérées et livraison PROCESSED dans une même
// transaction. Si le worker meurt, le cron reprend les livraisons en attente (`drainDeliveries`).
import { withOrgTransaction } from "@/server/db";
import { normalizeWebhook } from "@/server/connectors/github/normalizers";
import { createEvidence, type EvidenceDependencies } from "@/server/services/evidence";
import {
  claimDeliveries,
  failDelivery,
  finishDelivery,
  resolveIntegration,
  type ClaimedDelivery,
} from "@/server/system/webhooks";
import type { IntegrationProvider } from "@/generated/prisma/enums";

export type DeliveryOutcome = "processed" | "ignored" | "retry" | "failed" | "lease_lost";

const repositoryIdOf = (payload: unknown) => {
  const id = (payload as { repository?: { id?: unknown } } | null)?.repository?.id;
  return typeof id === "number" ? String(id) : null;
};

export async function handleDelivery(
  delivery: ClaimedDelivery,
  deps?: Partial<EvidenceDependencies>,
): Promise<DeliveryOutcome> {
  try {
    if (delivery.provider !== "GITHUB") {
      return (await finishDelivery(
        delivery,
        "IGNORED",
        undefined,
        "fournisseur non pris en charge",
      ))
        ? "ignored"
        : "lease_lost";
    }
    const integration = await resolveIntegration("GITHUB", delivery.externalAccountId);
    if (!integration || integration.status !== "ACTIVE") {
      return (await finishDelivery(
        delivery,
        "IGNORED",
        undefined,
        "installation non liée ou inactive",
      ))
        ? "ignored"
        : "lease_lost";
    }
    const repositoryId = repositoryIdOf(delivery.payload);
    const outcome = await withOrgTransaction(integration.orgId, async (tx) => {
      const resource = repositoryId
        ? await tx.integrationResource.findFirst({
            where: {
              integrationId: integration.integrationId,
              kind: "github_repo",
              externalId: repositoryId,
            },
          })
        : null;
      const evidence = resource
        ? normalizeWebhook(delivery.eventType, delivery.payload, {
            orgId: integration.orgId,
            resourceId: resource.id,
            capturedVia: "WEBHOOK",
          })
        : [];
      for (const item of evidence) {
        await createEvidence(
          tx,
          integration.orgId,
          { ...item, raw: delivery.payload },
          deps && deps.store && deps.master
            ? { store: deps.store, master: deps.master, now: deps.now ?? (() => new Date()) }
            : undefined,
        );
      }
      await tx.integration.update({
        where: { id: integration.integrationId },
        data: { lastEventAt: new Date() },
      });
      const status = evidence.length > 0 ? "PROCESSED" : "IGNORED";
      const finished = await finishDelivery(
        delivery,
        status,
        tx,
        resource ? (evidence.length > 0 ? undefined : "événement non suivi") : "dépôt non lié",
      );
      if (!finished) throw new LeaseLost();
      return status === "PROCESSED" ? "processed" : "ignored";
    });
    return outcome;
  } catch (error) {
    if (error instanceof LeaseLost) return "lease_lost";
    // Jamais la charge dans le message : seulement le type d'erreur et son message.
    const message = error instanceof Error ? `${error.name}: ${error.message}` : "erreur inconnue";
    return failDelivery(delivery, message);
  }
}

class LeaseLost extends Error {}

/** Traite aussitôt une livraison qui vient d'arriver (route handler, par waitUntil). */
export async function processDelivery(provider: IntegrationProvider, deliveryId: string) {
  const [delivery] = await claimDeliveries(1, { provider, deliveryId });
  return delivery ? handleDelivery(delivery) : null;
}

/** Reprise par le cron des livraisons en attente ou abandonnées. */
export async function drainDeliveries(limit = 50) {
  const stats: Record<DeliveryOutcome, number> = {
    processed: 0,
    ignored: 0,
    retry: 0,
    failed: 0,
    lease_lost: 0,
  };
  for (const delivery of await claimDeliveries(limit)) stats[await handleDelivery(delivery)] += 1;
  return stats;
}
