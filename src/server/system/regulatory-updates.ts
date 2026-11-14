// Lecture des entrées du fil de veille (PL-603), table système `RegulatoryUpdate` : sans dépendance aux jobs, pour être
// lue par les services (écran de veille, emails) sans cycle d'import.
import { prisma } from "@/server/db";

/** Entrées publiées, de la plus récente à la plus ancienne (lecture pour l'écran de veille). */
export function listWatchUpdates(now = new Date()) {
  return prisma.regulatoryUpdate.findMany({
    where: { publishedAt: { lte: now } },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
  });
}

export function watchUpdate(id: string) {
  return prisma.regulatoryUpdate.findUnique({ where: { id } });
}
