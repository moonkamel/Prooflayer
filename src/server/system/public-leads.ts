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

/** Durées de conservation annoncées par la politique de confidentialité (PL-606). */
export const LEAD_RETENTION_DAYS = { withoutConsent: 30, withConsent: 3 * 365 } as const;

/** Purge quotidienne : sans accord de recontact, 30 jours ; avec accord, trois ans après la demande. */
export async function prunePublicLeads(now = new Date()) {
  const day = 86_400_000;
  const { count } = await prisma.publicLead.deleteMany({
    where: {
      OR: [
        {
          contactConsent: false,
          createdAt: { lt: new Date(now.getTime() - LEAD_RETENTION_DAYS.withoutConsent * day) },
        },
        {
          contactConsent: true,
          createdAt: { lt: new Date(now.getTime() - LEAD_RETENTION_DAYS.withConsent * day) },
        },
      ],
    },
  });
  return count;
}
