// Santé du service (PL-108), lue par la surveillance de disponibilité : la base répond. Aucune donnée métier.
// PL-609 : la file de jobs est drainée (aucun job dû depuis plus de 10 minutes). Un arrêt des crons Vercel, qui
// empêcherait aussi la surveillance interne de tourner, est ainsi vu de l'extérieur (Better Stack, §4.2).
import { prisma } from "@/server/db";
import { MONITOR_THRESHOLDS } from "./monitoring-data";

export async function healthCheck(now: Date = new Date()): Promise<{
  ok: boolean;
  database: "up" | "down";
  queue: "ok" | "lagging" | "unknown";
}> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return { ok: false, database: "down", queue: "unknown" };
  }
  const lagging = await prisma.job.count({
    where: {
      status: "QUEUED",
      runAt: { lt: new Date(now.getTime() - MONITOR_THRESHOLDS.queueLagMinutes * 60_000) },
    },
  });
  return { ok: lagging === 0, database: "up", queue: lagging === 0 ? "ok" : "lagging" };
}
