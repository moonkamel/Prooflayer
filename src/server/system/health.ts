// Santé du service (PL-108), lue par la surveillance de disponibilité : la base répond. Aucune donnée métier.
import { prisma } from "@/server/db";

export async function healthCheck(): Promise<{ ok: boolean; database: "up" | "down" }> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, database: "up" };
  } catch {
    return { ok: false, database: "down" };
  }
}
