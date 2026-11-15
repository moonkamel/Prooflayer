// PL-609 — Surveillance d'exploitation (« être alerté avant le client »), fonctions pures : à partir d'un relevé,
// liste des constats à signaler. Seuils fixés ici, pas de donnée client (décomptes, âges, codes).
import { anchorOverdue } from "@/server/seal/anchor";

export const MONITOR_THRESHOLDS = {
  /** Job dû depuis plus longtemps : la file n'est plus drainée (cron arrêté, worker bloqué). */
  queueLagMinutes: 10,
  /** Livraison webhook en attente depuis plus longtemps : traitement bloqué. */
  webhookLagMinutes: 10,
  /** Part d'échecs définitifs sur l'heure écoulée (jobs et livraisons), au-delà d'un minimum d'activité. */
  errorRate: 0.1,
  errorRateMinSample: 20,
} as const;

export interface MonitorSnapshot {
  now: Date;
  queue: {
    oldestDueAt: Date | null;
    expiredLeases: number;
    failedLastHour: number;
    doneLastHour: number;
  };
  webhooks: { oldestPendingAt: Date | null; failedLastHour: number; processedLastHour: number };
  anchor: { oldestPendingSealedAt: Date | null };
  integrations: { provider: string; status: string; count: number }[];
}

export type MonitorFinding =
  | { code: "ops.queueLagging"; details: { lagMinutes: number; expiredLeases: number } }
  | { code: "seal.anchorOverdue"; details: { pendingSinceMinutes: number } }
  | { code: "ops.connectorError"; details: { provider: string; status: string; count: number } }
  | { code: "ops.webhookLagging"; details: { lagMinutes: number } }
  | {
      code: "ops.errorRate";
      details: { source: "jobs" | "webhooks"; failed: number; total: number; rate: number };
    };

const minutes = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / 60_000);

function rate(source: "jobs" | "webhooks", failed: number, ok: number): MonitorFinding | null {
  const total = failed + ok;
  if (total < MONITOR_THRESHOLDS.errorRateMinSample) return null;
  const r = failed / total;
  return r > MONITOR_THRESHOLDS.errorRate
    ? {
        code: "ops.errorRate",
        details: { source, failed, total, rate: Math.round(r * 1000) / 1000 },
      }
    : null;
}

export function monitorFindings(s: MonitorSnapshot): MonitorFinding[] {
  const findings: MonitorFinding[] = [];
  const lag = s.queue.oldestDueAt ? minutes(s.queue.oldestDueAt, s.now) : 0;
  if (lag > MONITOR_THRESHOLDS.queueLagMinutes || s.queue.expiredLeases > 0) {
    findings.push({
      code: "ops.queueLagging",
      details: { lagMinutes: Math.max(lag, 0), expiredLeases: s.queue.expiredLeases },
    });
  }
  const webhookLag = s.webhooks.oldestPendingAt ? minutes(s.webhooks.oldestPendingAt, s.now) : 0;
  if (webhookLag > MONITOR_THRESHOLDS.webhookLagMinutes) {
    findings.push({ code: "ops.webhookLagging", details: { lagMinutes: webhookLag } });
  }
  if (anchorOverdue(s.anchor.oldestPendingSealedAt, s.now)) {
    findings.push({
      code: "seal.anchorOverdue",
      details: { pendingSinceMinutes: minutes(s.anchor.oldestPendingSealedAt!, s.now) },
    });
  }
  for (const i of s.integrations) {
    if (i.status === "ERROR" || i.status === "REVOKED") {
      findings.push({ code: "ops.connectorError", details: i });
    }
  }
  for (const finding of [
    rate("jobs", s.queue.failedLastHour, s.queue.doneLastHour),
    rate("webhooks", s.webhooks.failedLastHour, s.webhooks.processedLastHour),
  ]) {
    if (finding) findings.push(finding);
  }
  return findings;
}
