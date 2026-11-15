// PL-610 — Suivi des design partners par le fondateur (`pnpm partners`) : inscription au pilote (12 semaines gratuites,
// limites du plan Growth), session de mise en route, pack transmis à un tiers, remplacement ; relevé des quatre
// métriques du §1.4. Les données d'une organisation se lisent sous app.org_id (RLS).
import { prisma, withOrgTransaction } from "@/server/db";
import { PLAN_LIMITS } from "@/server/services/billing-data";
import {
  cohortReport,
  PILOT_DAYS,
  type PackAudience,
  type PartnerFacts,
  type Segment,
} from "@/server/services/design-partners-data";
import { funnelFacts } from "@/server/services/funnel";
import { orgFunnel } from "@/server/services/funnel-data";

const DAY_MS = 86_400_000;

/** Ouvre le pilote : 12 semaines sans paiement, avec les limites du plan Growth (§7.5). */
export async function addPartner(orgId: string, segment: Segment, now = new Date()) {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) throw new Error(`Organisation inconnue : ${orgId}`);
  const partner = await prisma.designPartner.upsert({
    where: { orgId },
    create: { orgId, segment, pilotStartedAt: now },
    update: { segment },
  });
  const trialEndsAt = new Date(partner.pilotStartedAt.getTime() + PILOT_DAYS * DAY_MS);
  await withOrgTransaction(orgId, (tx) =>
    tx.subscription.upsert({
      where: { orgId },
      create: {
        orgId,
        plan: "TRIAL",
        status: "trialing",
        trialEndsAt,
        monitoredSystemsLimit: PLAN_LIMITS.GROWTH.monitoredSystems,
      },
      // Un abonnement payant déjà souscrit n'est jamais touché.
      update: {},
    }),
  );
  await withOrgTransaction(orgId, (tx) =>
    tx.subscription.updateMany({
      where: { orgId, plan: "TRIAL" },
      data: { trialEndsAt, monitoredSystemsLimit: PLAN_LIMITS.GROWTH.monitoredSystems },
    }),
  );
  return { orgId, pilotStartedAt: partner.pilotStartedAt, trialEndsAt };
}

export const recordSession = (orgId: string, at = new Date()) =>
  prisma.designPartner.update({ where: { orgId }, data: { sessionAt: at } });

export const recordPackShared = (orgId: string, audience: PackAudience, at = new Date()) =>
  prisma.designPartner.update({
    where: { orgId },
    data: { packSharedAt: at, packAudience: audience },
  });

export const markReplaced = (orgId: string, at = new Date()) =>
  prisma.designPartner.update({ where: { orgId }, data: { replacedAt: at } });

export async function partnerFacts(): Promise<PartnerFacts[]> {
  const partners = await prisma.designPartner.findMany({
    orderBy: { pilotStartedAt: "asc" },
    include: { org: { select: { name: true } } },
  });
  const facts: PartnerFacts[] = [];
  for (const p of partners) {
    const { events, instances, github, subscription } = await withOrgTransaction(
      p.orgId,
      async (tx) => ({
        ...(await funnelFacts(tx, p.orgId)),
        github: await tx.integration.findFirst({
          where: { orgId: p.orgId, provider: "GITHUB" },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
        subscription: await tx.subscription.findUnique({ where: { orgId: p.orgId } }),
      }),
    );
    facts.push({
      orgId: p.orgId,
      name: p.org.name,
      segment: p.segment as Segment,
      pilotStartedAt: p.pilotStartedAt,
      sessionAt: p.sessionAt,
      packSharedAt: p.packSharedAt,
      packAudience: p.packAudience as PackAudience | null,
      replacedAt: p.replacedAt,
      githubConnectedAt: github?.createdAt ?? null,
      paying: Boolean(
        subscription?.stripeSubscriptionId &&
        subscription.plan !== "TRIAL" &&
        ["active", "trialing"].includes(subscription.status),
      ),
      funnel: orgFunnel(events, instances),
    });
  }
  return facts;
}

export async function partnersReport(now = new Date()) {
  return cohortReport(await partnerFacts(), now);
}
