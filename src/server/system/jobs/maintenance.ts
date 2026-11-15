// Revue finale — Ménage quotidien en jobs indépendants. Le cron quotidien ne fait plus que programmer : chaque tâche
// a sa propre tentative (4 minutes au plus, sous le bail), ses propres nouveaux essais, et une tâche lente ou en
// échec ne prive plus les suivantes de leur passage.
import { z } from "zod";
import { prisma, withOrgTransaction } from "@/server/db";
import { expireExports } from "@/server/services/org-export";
import { createObjectStore, type ObjectStore } from "@/server/storage/object-store";
import { syncAllFunnels } from "../funnel";
import { scheduleOrgDeletions } from "../org-deletion-schedule";
import { prunePublicLeads } from "../public-leads";
import { pruneRateLimits } from "../rate-limit";
import { pruneDeliveries } from "../webhooks";
import { enqueue } from "./queue";
import { defineJob } from "./registry";

export const MAINTENANCE_TASKS = [
  "rateLimits",
  "publicLeads",
  "deliveries",
  "deletions",
  "funnel",
  "storage",
] as const;
export type MaintenanceTask = (typeof MAINTENANCE_TASKS)[number];

/** Un dépôt jamais enregistré reste au plus ce temps dans la zone d'arrivée (fichier en clair). */
export const INCOMING_TTL_MS = 24 * 3_600_000;

/** Dépendances remplaçables par les tests. */
export const maintenanceDependencies: { store: () => ObjectStore; now: () => Date } = {
  store: () => createObjectStore(),
  now: () => new Date(),
};

/** Stockage : exports expirés (7 jours) et dépôts abandonnés dans la zone d'arrivée (24 heures). */
export async function pruneStorage(now: Date, store: ObjectStore) {
  const orgs = await prisma.organization.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  let exports = 0;
  let uploads = 0;
  for (const { id } of orgs) {
    exports += await withOrgTransaction(id, (tx) => expireExports(tx, id, store, now));
    uploads += await store.deleteOlderThan(
      `orgs/${id}/incoming/`,
      new Date(now.getTime() - INCOMING_TTL_MS),
    );
  }
  return { exports, uploads };
}

async function run(task: MaintenanceTask): Promise<unknown> {
  const now = maintenanceDependencies.now();
  switch (task) {
    case "rateLimits":
      return pruneRateLimits(now.getTime());
    case "publicLeads":
      return prunePublicLeads(now);
    case "deliveries":
      return pruneDeliveries(now);
    case "deletions":
      return scheduleOrgDeletions(now);
    case "funnel":
      return (await syncAllFunnels()).created;
    case "storage":
      return pruneStorage(now, maintenanceDependencies.store());
  }
}

export const maintenanceJob = defineJob({
  type: "maintenance.daily",
  schema: z.object({
    task: z.enum(MAINTENANCE_TASKS),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  }),
  timeoutMs: 240_000,
  maxAttempts: 4,
  handle: async ({ task }) => {
    await run(task);
  },
});

/** Programme les tâches du jour, une fois chacune. */
export async function scheduleMaintenance(now: Date = new Date()) {
  const day = now.toISOString().slice(0, 10);
  let scheduled = 0;
  for (const task of MAINTENANCE_TASKS) {
    const result = await enqueue(
      maintenanceJob,
      { task, day },
      { dedupeKey: `maintenance:${task}:${day}` },
    );
    if (!result.deduplicated) scheduled += 1;
  }
  return { day, scheduled };
}
