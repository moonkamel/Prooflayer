// Facturation (PL-601, §3.2 E11, §6.1) : fonctions pures. Plans et limites, correspondance des tarifs Stripe (en
// configuration, variables `STRIPE_PRICE_<PLAN>_<MONTH|YEAR>`), lecture d'un abonnement Stripe relu, accès qui en
// découle (lecture seule appliquée par PL-602).
export const PAID_PLANS = ["STARTER", "GROWTH", "SCALE"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export type Plan = "TRIAL" | PaidPlan;
export const INTERVALS = ["month", "year"] as const;
export type Interval = (typeof INTERVALS)[number];

/** Limites du §6.1. Essai : fonctions du plan Growth, limité à 1 système surveillé (§3.2 E11). */
export const PLAN_LIMITS: Record<Plan, { monitoredSystems: number; repositories: number | null }> =
  {
    TRIAL: { monitoredSystems: 1, repositories: null },
    STARTER: { monitoredSystems: 1, repositories: 10 },
    GROWTH: { monitoredSystems: 5, repositories: null },
    SCALE: { monitoredSystems: 20, repositories: null },
  };

/** Formules proposées (§6.1) : pas de mensuel sans engagement pour Scale. */
export const OFFERS: readonly { plan: PaidPlan; interval: Interval }[] = [
  { plan: "STARTER", interval: "year" },
  { plan: "STARTER", interval: "month" },
  { plan: "GROWTH", interval: "year" },
  { plan: "GROWTH", interval: "month" },
  { plan: "SCALE", interval: "year" },
];

export const TRIAL_DAYS = 14;
/** Lecture seule après l'essai ou un impayé (§3.2 E11). */
export const READ_ONLY_DAYS = 30;
const DAY_MS = 86_400_000;

export interface PriceConfig {
  /** priceId → formule. */
  byPrice: ReadonlyMap<string, { plan: PaidPlan; interval: Interval }>;
  /** formule → priceId. */
  byOffer: ReadonlyMap<string, string>;
}

const offerKey = (plan: PaidPlan, interval: Interval) => `${plan}:${interval}`;

export function priceConfig(env: Record<string, string | undefined> = process.env): PriceConfig {
  const byPrice = new Map<string, { plan: PaidPlan; interval: Interval }>();
  const byOffer = new Map<string, string>();
  for (const { plan, interval } of OFFERS) {
    const id = env[`STRIPE_PRICE_${plan}_${interval.toUpperCase()}`]?.trim();
    if (!id) continue;
    byPrice.set(id, { plan, interval });
    byOffer.set(offerKey(plan, interval), id);
  }
  return { byPrice, byOffer };
}

export function priceFor(config: PriceConfig, plan: PaidPlan, interval: Interval) {
  return config.byOffer.get(offerKey(plan, interval)) ?? null;
}

/** Sous-ensemble d'un abonnement Stripe relu (`subscriptions.retrieve`), selon la version d'API. */
export interface StripeSubscriptionLike {
  id: string;
  status: string;
  customer: string | { id: string };
  metadata?: Record<string, string> | null;
  cancel_at_period_end?: boolean;
  current_period_end?: number | null;
  trial_end?: number | null;
  items: { data: { price: { id: string }; current_period_end?: number | null }[] };
}

export interface SubscriptionState {
  plan: PaidPlan;
  interval: Interval;
  priceId: string;
  status: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  monitoredSystemsLimit: number;
}

export type StateError = "unknown_price" | "no_item";

/** État à écrire sur `Subscription` à partir de l'abonnement relu chez Stripe. */
export function subscriptionState(
  sub: StripeSubscriptionLike,
  config: PriceConfig,
): SubscriptionState | { error: StateError } {
  const item = sub.items.data[0];
  if (!item) return { error: "no_item" };
  const offer = config.byPrice.get(item.price.id);
  if (!offer) return { error: "unknown_price" };
  // Versions récentes de l'API : la fin de période est portée par l'élément de l'abonnement.
  const end = item.current_period_end ?? sub.current_period_end ?? null;
  return {
    plan: offer.plan,
    interval: offer.interval,
    priceId: item.price.id,
    status: sub.status,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    currentPeriodEnd: end ? new Date(end * 1000) : null,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    monitoredSystemsLimit: PLAN_LIMITS[offer.plan].monitoredSystems,
  };
}

/** Statuts Stripe d'un abonnement terminé ou abandonné (un événement en retard ne doit pas écraser le suivant). */
export const ENDED_STATUSES = new Set(["canceled", "incomplete_expired"]);

/**
 * Un abonnement relu remplace-t-il celui enregistré ? Oui s'il s'agit du même, ou s'il est vivant. Un ancien
 * abonnement terminé, reçu après qu'un nouveau a été souscrit, est ignoré (événements dans le désordre).
 */
export function supersedes(
  stored: { stripeSubscriptionId: string | null; status: string },
  incoming: { stripeSubscriptionId: string; status: string },
): boolean {
  if (!stored.stripeSubscriptionId || stored.stripeSubscriptionId === incoming.stripeSubscriptionId)
    return true;
  return !ENDED_STATUSES.has(incoming.status) || ENDED_STATUSES.has(stored.status);
}

export type Access =
  | { kind: "trial"; endsAt: Date | null; daysLeft: number }
  | { kind: "active" }
  | { kind: "readOnly"; reason: "trialExpired" | "pastDue" | "canceled"; until: Date | null };

/** Accès d'une organisation (§3.2 E11) ; la lecture seule elle-même est appliquée par PL-602. */
export function accessOf(
  sub: { plan: Plan; status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null },
  now: Date,
): Access {
  if (sub.plan === "TRIAL") {
    if (!sub.trialEndsAt || sub.trialEndsAt > now) {
      const daysLeft = sub.trialEndsAt
        ? Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / DAY_MS))
        : TRIAL_DAYS;
      return { kind: "trial", endsAt: sub.trialEndsAt, daysLeft };
    }
    return {
      kind: "readOnly",
      reason: "trialExpired",
      until: new Date(sub.trialEndsAt.getTime() + READ_ONLY_DAYS * DAY_MS),
    };
  }
  if (sub.status === "active" || sub.status === "trialing") return { kind: "active" };
  const from = sub.currentPeriodEnd ?? now;
  const until = new Date(from.getTime() + READ_ONLY_DAYS * DAY_MS);
  if (ENDED_STATUSES.has(sub.status)) return { kind: "readOnly", reason: "canceled", until };
  return { kind: "readOnly", reason: "pastDue", until };
}

/** Identifiant de l'abonnement visé par un événement Stripe, ou null si l'événement n'en désigne pas. */
export function subscriptionIdOf(event: {
  type: string;
  data: { object: unknown };
}): string | null {
  const o = event.data.object as Record<string, unknown> | null;
  if (!o) return null;
  const id = (v: unknown) =>
    typeof v === "string" ? v : v && typeof v === "object" && "id" in v ? String(v.id) : null;
  switch (event.type) {
    case "checkout.session.completed":
      return o.mode === "subscription" ? id(o.subscription) : null;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return id(o.id);
    case "invoice.payment_failed": {
      const parent = o.parent as { subscription_details?: { subscription?: unknown } } | undefined;
      return id(o.subscription) ?? id(parent?.subscription_details?.subscription);
    }
    default:
      return null;
  }
}

export const TRACKED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
]);

/**
 * Procédures tRPC bloquées en lecture seule (§3.2 E11 : essai expiré ou impayé) : toute écriture métier. Restent
 * permises la facturation (pour régulariser), l'organisation et ses membres, les notifications ; les lectures et
 * exports (registre, journal, téléchargement des packs existants) sont des requêtes, jamais bloquées.
 */
const READ_ONLY_BLOCKED = [
  "system.",
  "classification.",
  "control.",
  "evidence.",
  "exemption.",
  "integration.",
  "pack.create",
];

export function blockedWhenReadOnly(path: string): boolean {
  return READ_ONLY_BLOCKED.some((p) => (p.endsWith(".") ? path.startsWith(p) : path === p));
}

/** Un système de plus peut-il être surveillé ? Rien n'est jamais retiré au dépassement (§3.2 E11). */
export function canMonitorAnother(monitoredCount: number, limit: number): boolean {
  return monitoredCount < limit;
}

/** Un dépôt de plus peut-il être lié (Starter : 10, §6.1) ? `null` : illimité. */
export function canLinkRepository(linkedCount: number, limit: number | null): boolean {
  return limit === null || linkedCount < limit;
}
