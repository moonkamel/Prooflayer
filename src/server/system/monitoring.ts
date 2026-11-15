// PL-609 — Relevé d'exploitation et alertes (/api/cron/monitor, toutes les 15 minutes) : file de jobs en retard,
// livraisons webhook bloquées, ancre manquée, connecteurs en erreur, taux d'échec. Chaque constat part par
// `raiseOperationalAlert` (Sentry + journal), sans donnée client. Les connecteurs se lisent organisation par
// organisation (RLS) ; les lots en attente par la fonction pending_batches_for_anchor.
import { prisma, withOrgTransaction } from "@/server/db";
import { raiseOperationalAlert } from "./alerts";
import { pendingBatches } from "./anchoring";
import { LEASE_MS } from "./jobs/queue";
import { monitorFindings, type MonitorSnapshot } from "./monitoring-data";

export async function monitorSnapshot(now: Date = new Date()): Promise<MonitorSnapshot> {
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const [
    oldestDue,
    expiredLeases,
    failedJobs,
    doneJobs,
    oldestDelivery,
    failedDeliveries,
    processed,
    pending,
  ] = await Promise.all([
    prisma.job.findFirst({
      where: { status: "QUEUED", runAt: { lte: now } },
      orderBy: { runAt: "asc" },
      select: { runAt: true },
    }),
    prisma.job.count({
      where: { status: "RUNNING", lockedAt: { lt: new Date(now.getTime() - LEASE_MS) } },
    }),
    prisma.job.count({ where: { status: "FAILED", finishedAt: { gte: hourAgo } } }),
    prisma.job.count({ where: { status: "DONE", finishedAt: { gte: hourAgo } } }),
    prisma.webhookDelivery.findFirst({
      where: { status: "PENDING", nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: "asc" },
      select: { nextAttemptAt: true },
    }),
    prisma.webhookDelivery.count({ where: { status: "FAILED", receivedAt: { gte: hourAgo } } }),
    prisma.webhookDelivery.count({
      where: { status: { in: ["PROCESSED", "IGNORED"] }, processedAt: { gte: hourAgo } },
    }),
    prisma.$transaction((tx) => pendingBatches(tx, 1)),
  ]);

  const totals = new Map<string, number>();
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  for (const { id } of orgs) {
    const rows = await withOrgTransaction(id, (tx) =>
      tx.integration.groupBy({
        by: ["provider", "status"],
        where: { orgId: id, status: { in: ["ERROR", "REVOKED"] } },
        _count: { _all: true },
      }),
    );
    for (const r of rows) {
      const key = `${r.provider}:${r.status}`;
      totals.set(key, (totals.get(key) ?? 0) + r._count._all);
    }
  }

  return {
    now,
    queue: {
      oldestDueAt: oldestDue?.runAt ?? null,
      expiredLeases,
      failedLastHour: failedJobs,
      doneLastHour: doneJobs,
    },
    webhooks: {
      oldestPendingAt: oldestDelivery?.nextAttemptAt ?? null,
      failedLastHour: failedDeliveries,
      processedLastHour: processed,
    },
    anchor: { oldestPendingSealedAt: pending[0]?.sealedAt ?? null },
    integrations: [...totals.entries()].map(([key, count]) => {
      const [provider, status] = key.split(":") as [string, string];
      return { provider, status, count };
    }),
  };
}

/** Relevé, constats, alertes ; renvoie les codes levés (sans détail). */
export async function runMonitoring(now: Date = new Date()) {
  const findings = monitorFindings(await monitorSnapshot(now));
  for (const f of findings) raiseOperationalAlert(f.code, f.details);
  return { alerts: findings.map((f) => f.code) };
}
