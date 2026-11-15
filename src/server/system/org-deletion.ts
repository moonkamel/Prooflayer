// PL-607 — Suppression programmée des organisations, côté système : table `OrganizationDeletion` (sans RLS, elle
// survit à la purge), échéances quotidiennes et purge par la fonction SQL `purge_organization` (SECURITY DEFINER, seule
// à poser app.purge_org). La logique de demande et d'annulation par un owner vit dans services/org-deletion.ts.
import { accessOf, type Plan } from "@/server/services/billing-data";
import { prisma, withOrgTransaction } from "@/server/db";
import type { OrgTransaction } from "@/server/db";

const DAY_MS = 86_400_000;

/** Délai entre la demande (ou l'avis de fin de contrat) et la purge : l'owner peut annuler pendant ce temps. */
export const DELETION_GRACE_DAYS = 7;
/** §4.7 : « purge à 90 jours » après la fin de l'abonnement (30 jours de lecture seule compris). */
export const CONTRACT_END_PURGE_DAYS = 90;

export function pendingDeletion(orgId: string) {
  return prisma.organizationDeletion.findFirst({
    where: { orgId, cancelledAt: null, completedAt: null },
    select: {
      id: true,
      reason: true,
      requestedAt: true,
      scheduledFor: true,
      requestedByUserId: true,
    },
  });
}

export function scheduleDeletion(input: {
  orgId: string;
  reason: "owner_request" | "contract_end";
  requestedByUserId: string | null;
  scheduledFor: Date;
}) {
  return prisma.organizationDeletion.create({
    data: input,
    select: { id: true, scheduledFor: true },
  });
}

export async function cancelPendingDeletion(orgId: string, now: Date) {
  const { count } = await prisma.organizationDeletion.updateMany({
    where: { orgId, cancelledAt: null, completedAt: null },
    data: { cancelledAt: now },
  });
  return count;
}

export function deletionById(
  id: string,
  client: Pick<OrgTransaction, "organizationDeletion"> = prisma,
) {
  return client.organizationDeletion.findUnique({ where: { id } });
}

/**
 * Fin de contrat : 90 jours après la fin de l'abonnement, purge. L'avis part `DELETION_GRACE_DAYS` avant ; une
 * échéance déjà passée (organisation restée sans abonnement) laisse tout de même ce délai d'avis. Une organisation
 * sans abonnement enregistré n'est jamais purgée d'office.
 */
export function contractEndPurgeAt(
  sub: { plan: Plan; status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null },
  now: Date,
): Date | null {
  const access = accessOf(sub, now);
  if (access.kind !== "readOnly" || !access.until) return null;
  // until = fin de l'abonnement + 30 jours ; purge à fin + 90 jours.
  return new Date(access.until.getTime() + (CONTRACT_END_PURGE_DAYS - 30) * DAY_MS);
}

/** Passage quotidien : avis de fin de contrat à J-7, puis purges arrivées à échéance (ids à programmer). */
export async function dueDeletions(now: Date) {
  const orgs = await prisma.organization.findMany({ select: { id: true }, orderBy: { id: "asc" } });
  let noticed = 0;
  const newlyScheduled: string[] = [];
  for (const { id } of orgs) {
    const sub = await withOrgTransaction(id, (tx) =>
      tx.subscription.findUnique({ where: { orgId: id } }),
    );
    if (!sub) continue;
    const purgeAt = contractEndPurgeAt(sub as never, now);
    if (!purgeAt || now.getTime() < purgeAt.getTime() - DELETION_GRACE_DAYS * DAY_MS) continue;
    if (await pendingDeletion(id)) continue;
    const scheduledFor = new Date(
      Math.max(purgeAt.getTime(), now.getTime() + DELETION_GRACE_DAYS * DAY_MS),
    );
    const row = await scheduleDeletion({
      orgId: id,
      reason: "contract_end",
      requestedByUserId: null,
      scheduledFor,
    });
    newlyScheduled.push(row.id);
    noticed += 1;
  }
  const due = await prisma.organizationDeletion.findMany({
    where: { cancelledAt: null, confirmedAt: null, scheduledFor: { lte: now } },
    select: { id: true },
  });
  return { noticed, newlyScheduled, due: due.map((d) => d.id) };
}

/** Purge en base (fonction SQL unique), dans la transaction du job. */
export async function purgeOrganizationRows(tx: OrgTransaction, orgId: string) {
  const [row] = await tx.$queryRaw<{ removed: number }[]>`
    SELECT purge_organization(${orgId}) AS removed`;
  return row?.removed ?? 0;
}
