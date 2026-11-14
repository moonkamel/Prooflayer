// Abonnement Stripe (PL-601, §3.2 E11, prompt-type du §9.8). Essai de 14 jours sans carte à la création de
// l'organisation ; souscription par Stripe Checkout (carte ou prélèvement SEPA, mensuel ou annuel, numéro de TVA
// intracommunautaire collecté, Stripe Tax si STRIPE_TAX=true) ; portail client Stripe ; synchronisation de
// `Subscription` à chaque webhook, en relisant l'abonnement auprès de Stripe (l'ordre d'arrivée n'est pas fiable).
import Stripe from "stripe";
import { withOrgTransaction, type OrgTransaction } from "@/server/db";
import { raiseOperationalAlert } from "@/server/system/alerts";
import { usersByIds } from "@/server/system/identity";
import { audit, clientIp } from "./audit";
import {
  accessOf,
  OFFERS,
  PLAN_LIMITS,
  priceConfig,
  priceFor,
  subscriptionIdOf,
  subscriptionState,
  supersedes,
  TRIAL_DAYS,
  type Access,
  type Interval,
  type PaidPlan,
  type PriceConfig,
  type StripeSubscriptionLike,
} from "./billing-data";
import { ServiceError } from "./errors";
import type { OrgContext } from "./organization";

const DAY_MS = 86_400_000;
/** Stripe Checkout exige un essai d'au moins 48 h ; en deçà, la facturation commence aussitôt. */
const MIN_TRIAL_CARRY_MS = 2 * DAY_MS + 3_600_000;

/** Sous-ensemble du client Stripe utilisé ici (remplaçable par les tests). */
export interface StripeClient {
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string | null }>;
    };
  };
  billingPortal: {
    sessions: {
      create(params: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }>;
    };
  };
  subscriptions: { retrieve(id: string): Promise<StripeSubscriptionLike> };
}

export interface BillingDependencies {
  stripe: () => StripeClient;
  config: () => PriceConfig;
  baseUrl: string;
  automaticTax: boolean;
  /** Configuration de moyens de paiement Stripe (carte et SEPA), facultative : `STRIPE_PAYMENT_METHOD_CONFIGURATION`. */
  paymentMethodConfiguration: string | null;
  now: () => Date;
}

export function stripeConfigured(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.STRIPE_SECRET_KEY);
}

function stripeClient(): StripeClient {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new ServiceError("PRECONDITION_FAILED", "billing.notConfigured");
  return new Stripe(key) as unknown as StripeClient;
}

export const billingDependencies: { get: () => BillingDependencies } = {
  get: () => ({
    stripe: stripeClient,
    config: () => priceConfig(),
    baseUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    automaticTax: process.env.STRIPE_TAX === "true",
    paymentMethodConfiguration: process.env.STRIPE_PAYMENT_METHOD_CONFIGURATION || null,
    now: () => new Date(),
  }),
};

/** Essai de 14 jours, sans carte, posé à la création de l'organisation (idempotent). */
export async function startTrial(tx: OrgTransaction, orgId: string, now: Date) {
  await tx.subscription.upsert({
    where: { orgId },
    create: {
      orgId,
      plan: "TRIAL",
      status: "trialing",
      monitoredSystemsLimit: PLAN_LIMITS.TRIAL.monitoredSystems,
      trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
    },
    update: {},
  });
}

async function currentSubscription(tx: OrgTransaction, orgId: string, now: Date) {
  await startTrial(tx, orgId, now);
  return tx.subscription.findUniqueOrThrow({ where: { orgId } });
}

function serializeAccess(a: Access) {
  if (a.kind === "trial")
    return { kind: a.kind, daysLeft: a.daysLeft, endsAt: a.endsAt?.toISOString() ?? null };
  if (a.kind === "active") return { kind: a.kind };
  return { kind: a.kind, reason: a.reason, until: a.until?.toISOString() ?? null };
}

/** `billing.get` : abonnement, accès et formules proposées. Lecture : tout membre. */
export async function getBilling(ctx: OrgContext, deps = billingDependencies.get()) {
  const now = deps.now();
  const { sub, monitoredCount } = await withOrgTransaction(ctx.orgId, async (tx) => ({
    sub: await currentSubscription(tx, ctx.orgId, now),
    monitoredCount: await tx.aiSystem.count({
      where: { orgId: ctx.orgId, monitored: true, archivedAt: null },
    }),
  }));
  const config = stripeConfigured() ? deps.config() : { byOffer: new Map(), byPrice: new Map() };
  return {
    plan: sub.plan,
    status: sub.status,
    interval: sub.billingInterval,
    trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    monitoredSystemsLimit: sub.monitoredSystemsLimit,
    monitoredCount,
    hasCustomer: Boolean(sub.stripeCustomerId),
    access: serializeAccess(accessOf(sub, now)),
    offers: OFFERS.filter((o) => priceFor(config, o.plan, o.interval)),
  };
}

function record(
  ctx: OrgContext,
  action: "billing.checkout" | "billing.portal",
  metadata: Record<string, unknown>,
) {
  return audit(
    {
      orgId: ctx.orgId,
      actor: { type: "user", id: ctx.userId },
      ipAddress: clientIp(ctx.headers),
      db: ctx.db,
    },
    action,
    { type: "subscription", id: ctx.orgId },
    metadata,
  );
}

/** `billing.checkout` (owner) : session Stripe Checkout pour une formule ; renvoie l'adresse de redirection. */
export async function startCheckout(
  ctx: OrgContext,
  input: { plan: PaidPlan; interval: Interval; locale: "fr" | "en" },
  deps = billingDependencies.get(),
): Promise<{ url: string }> {
  const price = priceFor(deps.config(), input.plan, input.interval);
  if (!price) throw new ServiceError("BAD_REQUEST", "billing.offerUnavailable");
  const now = deps.now();
  const sub = await withOrgTransaction(ctx.orgId, (tx) => currentSubscription(tx, ctx.orgId, now));
  if (
    sub.stripeSubscriptionId &&
    sub.status !== "canceled" &&
    sub.status !== "incomplete_expired"
  ) {
    // Un abonnement vivant se modifie dans le portail client, jamais par un second abonnement.
    throw new ServiceError("CONFLICT", "billing.alreadySubscribed");
  }
  // L'essai restant est reporté : la première échéance tombe à sa fin.
  const trialEnd =
    sub.plan === "TRIAL" &&
    sub.trialEndsAt &&
    sub.trialEndsAt.getTime() - now.getTime() > MIN_TRIAL_CARRY_MS
      ? Math.floor(sub.trialEndsAt.getTime() / 1000)
      : undefined;
  const back = (state: string) =>
    new URL(`/organization/billing?checkout=${state}`, deps.baseUrl).toString();
  const session = await deps.stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    // Moyens de paiement (carte, prélèvement SEPA) : configuration de paiement du compte Stripe, ou celle désignée.
    ...(deps.paymentMethodConfiguration
      ? { payment_method_configuration: deps.paymentMethodConfiguration }
      : {}),
    client_reference_id: ctx.orgId,
    metadata: { orgId: ctx.orgId },
    subscription_data: {
      metadata: { orgId: ctx.orgId },
      ...(trialEnd ? { trial_end: trialEnd } : {}),
    },
    ...(sub.stripeCustomerId
      ? { customer: sub.stripeCustomerId }
      : { customer_email: (await usersByIds([ctx.userId])).get(ctx.userId)?.email }),
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    ...(sub.stripeCustomerId ? { customer_update: { address: "auto", name: "auto" } } : {}),
    automatic_tax: { enabled: deps.automaticTax },
    allow_promotion_codes: true,
    locale: input.locale,
    success_url: back("success"),
    cancel_url: back("cancel"),
  });
  if (!session.url) throw new ServiceError("PRECONDITION_FAILED", "billing.stripeUnavailable");
  await record(ctx, "billing.checkout", { plan: input.plan, interval: input.interval });
  return { url: session.url };
}

/** `billing.portal` (owner) : portail client Stripe (moyen de paiement, factures, changement de plan, résiliation). */
export async function openPortal(
  ctx: OrgContext,
  deps = billingDependencies.get(),
): Promise<{ url: string }> {
  const sub = await withOrgTransaction(ctx.orgId, (tx) =>
    tx.subscription.findUnique({ where: { orgId: ctx.orgId } }),
  );
  if (!sub?.stripeCustomerId) throw new ServiceError("PRECONDITION_FAILED", "billing.noCustomer");
  const session = await deps.stripe().billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: new URL("/organization/billing", deps.baseUrl).toString(),
  });
  await record(ctx, "billing.portal", {});
  return { url: session.url };
}

export type SyncOutcome =
  | { outcome: "synced"; orgId: string; plan: string; status: string }
  | { outcome: "ignored"; reason: string };

/**
 * Webhook Stripe : relit l'abonnement visé et écrit `Subscription` de son organisation (`metadata.orgId`, posé à la
 * création de la session Checkout). Idempotent et indifférent à l'ordre d'arrivée.
 */
export async function syncSubscriptionFromEvent(
  event: { id: string; type: string; data: { object: unknown } },
  deps = billingDependencies.get(),
): Promise<SyncOutcome> {
  const subscriptionId = subscriptionIdOf(event);
  if (!subscriptionId) return { outcome: "ignored", reason: "événement sans abonnement" };
  const sub = await deps.stripe().subscriptions.retrieve(subscriptionId);
  const orgId = sub.metadata?.orgId;
  if (!orgId) {
    raiseOperationalAlert("billing.orgMissing", { event: event.id, type: event.type });
    return { outcome: "ignored", reason: "abonnement sans organisation" };
  }
  const state = subscriptionState(sub, deps.config());
  if ("error" in state) {
    raiseOperationalAlert("billing.unknownPrice", { event: event.id, reason: state.error });
    return { outcome: "ignored", reason: state.error };
  }
  const now = deps.now();
  const result = await withOrgTransaction(orgId, async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!org) return null;
    const stored = await currentSubscription(tx, orgId, now);
    if (!supersedes(stored, state)) return { changed: false, stale: true };
    const changed = stored.plan !== state.plan || stored.status !== state.status;
    await tx.subscription.update({
      where: { orgId },
      data: {
        plan: state.plan,
        status: state.status,
        stripeCustomerId: state.stripeCustomerId,
        stripeSubscriptionId: state.stripeSubscriptionId,
        priceId: state.priceId,
        billingInterval: state.interval,
        currentPeriodEnd: state.currentPeriodEnd,
        trialEndsAt: state.trialEndsAt ?? stored.trialEndsAt,
        cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        monitoredSystemsLimit: state.monitoredSystemsLimit,
        syncedAt: now,
      },
    });
    return { changed, stale: false };
  });
  if (!result) {
    raiseOperationalAlert("billing.orgMissing", { event: event.id, type: event.type });
    return { outcome: "ignored", reason: "organisation inconnue" };
  }
  if (result.stale) return { outcome: "ignored", reason: "abonnement remplacé" };
  if (result.changed) {
    await audit(
      { orgId, actor: { type: "system", id: null } },
      "billing.subscriptionSynced",
      { type: "subscription", id: orgId },
      { plan: state.plan, status: state.status, interval: state.interval, event: event.type },
    );
  }
  return { outcome: "synced", orgId, plan: state.plan, status: state.status };
}
