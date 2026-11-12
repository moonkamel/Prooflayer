// Demandes de note du classifieur public (PL-208) : table système `PublicLead`, sans organisation, lue et écrite ici
// seulement (règle 1 de CLAUDE.md : `prisma` direct réservé à src/server/system/).
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

export function countRecentLeads(where: { email?: string; ipHash?: string }, since: Date) {
  return prisma.publicLead.count({ where: { ...where, createdAt: { gte: since } } });
}

export function createLead(data: Prisma.PublicLeadCreateInput) {
  return prisma.publicLead.create({ data, select: { id: true } });
}

export function leadById(
  id: string,
  client: Pick<Prisma.TransactionClient, "publicLead"> = prisma,
) {
  return client.publicLead.findUnique({ where: { id } });
}
