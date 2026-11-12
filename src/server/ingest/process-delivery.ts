// Traitement d'une livraison de webhook (PL-302, diagramme du §4.5.1) : installation → organisation, dépôt → ressource
// liée, normalisation et minimisation, charge brute chiffrée, preuves insérées et livraison PROCESSED dans une même
// transaction. Si le worker meurt, le cron reprend les livraisons en attente (`drainDeliveries`).
import { withOrgTransaction } from "@/server/db";
import { normalizeWebhook } from "@/server/connectors/github/normalizers";
import { createEvidence, type EvidenceDependencies } from "@/server/services/evidence";
import { scheduleEvaluations } from "@/server/services/evaluation";
import { scheduleEvaluation } from "@/server/system/jobs/control-evaluate";
import { jobRegistry } from "@/server/system/jobs/handlers";
import { runJobNow } from "@/server/system/jobs/queue";
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
      const created: { id: string; kind: string; resourceId: string | null }[] = [];
      for (const item of evidence) {
        const result = await createEvidence(
          tx,
          integration.orgId,
          { ...item, raw: delivery.payload },
          deps && deps.store && deps.master
            ? { store: deps.store, master: deps.master, now: deps.now ?? (() => new Date()) }
            : undefined,
        );
        if (result.created)
          created.push({ id: result.id, kind: item.kind, resourceId: item.resourceId ?? null });
      }
      // Réévaluation incrémentale (PL-401) : jobs control.evaluate dans la même transaction que les preuves.
      const jobs = await scheduleEvaluations(tx, integration.orgId, created, scheduleEvaluation);
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
      return { outcome: status === "PROCESSED" ? "processed" : "ignored", jobs } as const;
    });
    // Évaluation aussitôt après la validation (moins de 5 secondes, §3.2 E6) ; sinon le cron la reprend.
    for (const id of outcome.jobs) await runJobNow(id, jobRegistry).catch(() => undefined);
    return outcome.outcome;
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
