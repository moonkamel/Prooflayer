// PL-601 — Facturation, fonctions pures : correspondance des tarifs (configuration), abonnement Stripe relu → état,
// événements dans le désordre, accès (essai, actif, lecture seule de 30 jours), abonnement désigné par un événement.
import { describe, expect, it } from "vitest";
import {
  accessOf,
  OFFERS,
  PLAN_LIMITS,
  priceConfig,
  priceFor,
  subscriptionIdOf,
  subscriptionState,
  supersedes,
} from "@/server/services/billing-data";

const env = {
  STRIPE_PRICE_STARTER_YEAR: "price_sy",
  STRIPE_PRICE_STARTER_MONTH: "price_sm",
  STRIPE_PRICE_GROWTH_YEAR: "price_gy",
  STRIPE_PRICE_GROWTH_MONTH: " price_gm ",
  STRIPE_PRICE_SCALE_YEAR: "price_xy",
};
const config = priceConfig(env);
const now = new Date("2027-01-10T12:00:00Z");
const ts = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

describe("plans et tarifs", () => {
  it("grille du §6.1 : limites de systèmes et de dépôts ; pas de mensuel pour Scale", () => {
    expect(PLAN_LIMITS).toMatchObject({
      TRIAL: { monitoredSystems: 1 },
      STARTER: { monitoredSystems: 1, repositories: 10 },
      GROWTH: { monitoredSystems: 5, repositories: null },
      SCALE: { monitoredSystems: 20, repositories: null },
    });
    expect(OFFERS.filter((o) => o.plan === "SCALE")).toEqual([{ plan: "SCALE", interval: "year" }]);
  });

  it("tarifs lus en configuration, dans les deux sens ; formule non configurée : absente", () => {
    expect(priceFor(config, "GROWTH", "month")).toBe("price_gm");
    expect(config.byPrice.get("price_xy")).toEqual({ plan: "SCALE", interval: "year" });
    expect(priceFor(priceConfig({}), "STARTER", "year")).toBeNull();
  });
});

describe("abonnement relu chez Stripe", () => {
  const sub = (extra: Record<string, unknown> = {}) => ({
    id: "sub_1",
    status: "active",
    customer: "cus_1",
    metadata: { orgId: "org_1" },
    cancel_at_period_end: false,
    items: {
      data: [{ price: { id: "price_gy" }, current_period_end: ts("2028-01-10T00:00:00Z") }],
    },
    ...extra,
  });

  it("plan, formule, fin de période (portée par l'élément), limite du plan", () => {
    expect(subscriptionState(sub(), config)).toMatchObject({
      plan: "GROWTH",
      interval: "year",
      status: "active",
      stripeCustomerId: "cus_1",
      currentPeriodEnd: new Date("2028-01-10T00:00:00Z"),
      monitoredSystemsLimit: 5,
      cancelAtPeriodEnd: false,
    });
  });

  it("anciennes versions d'API : fin de période à la racine ; client développé", () => {
    const state = subscriptionState(
      sub({
        customer: { id: "cus_2" },
        current_period_end: ts("2027-02-10T00:00:00Z"),
        items: { data: [{ price: { id: "price_sm" } }] },
      }),
      config,
    );
    expect(state).toMatchObject({
      plan: "STARTER",
      stripeCustomerId: "cus_2",
      currentPeriodEnd: new Date("2027-02-10T00:00:00Z"),
    });
  });

  it("tarif inconnu ou abonnement sans élément : erreur, rien n'est écrit", () => {
    expect(
      subscriptionState(sub({ items: { data: [{ price: { id: "price_x" } }] } }), config),
    ).toEqual({
      error: "unknown_price",
    });
    expect(subscriptionState(sub({ items: { data: [] } }), config)).toEqual({ error: "no_item" });
  });

  it("dans le désordre : un ancien abonnement terminé n'écrase pas le nouveau", () => {
    const stored = { stripeSubscriptionId: "sub_new", status: "active" };
    expect(supersedes(stored, { stripeSubscriptionId: "sub_old", status: "canceled" })).toBe(false);
    expect(supersedes(stored, { stripeSubscriptionId: "sub_new", status: "canceled" })).toBe(true);
    expect(
      supersedes(
        { stripeSubscriptionId: null, status: "trialing" },
        { stripeSubscriptionId: "s", status: "active" },
      ),
    ).toBe(true);
    expect(
      supersedes(
        { stripeSubscriptionId: "sub_old", status: "canceled" },
        { stripeSubscriptionId: "sub_new", status: "active" },
      ),
    ).toBe(true);
  });
});

describe("accès", () => {
  it("essai en cours : jours restants ; terminé : lecture seule 30 jours", () => {
    expect(
      accessOf(
        {
          plan: "TRIAL",
          status: "trialing",
          trialEndsAt: new Date("2027-01-13T12:00:00Z"),
          currentPeriodEnd: null,
        },
        now,
      ),
    ).toMatchObject({ kind: "trial", daysLeft: 3 });
    expect(
      accessOf(
        {
          plan: "TRIAL",
          status: "trialing",
          trialEndsAt: new Date("2027-01-01T00:00:00Z"),
          currentPeriodEnd: null,
        },
        now,
      ),
    ).toEqual({
      kind: "readOnly",
      reason: "trialExpired",
      until: new Date("2027-01-31T00:00:00Z"),
    });
  });

  it("payant actif ; impayé et résilié : lecture seule 30 jours après la fin de période", () => {
    const end = new Date("2027-01-05T00:00:00Z");
    expect(
      accessOf({ plan: "GROWTH", status: "active", trialEndsAt: null, currentPeriodEnd: end }, now),
    ).toEqual({
      kind: "active",
    });
    expect(
      accessOf(
        { plan: "GROWTH", status: "past_due", trialEndsAt: null, currentPeriodEnd: end },
        now,
      ),
    ).toEqual({
      kind: "readOnly",
      reason: "pastDue",
      until: new Date("2027-02-04T00:00:00Z"),
    });
    expect(
      accessOf(
        { plan: "GROWTH", status: "canceled", trialEndsAt: null, currentPeriodEnd: end },
        now,
      ),
    ).toMatchObject({
      reason: "canceled",
    });
  });
});

describe("événements suivis", () => {
  it("chaque événement désigne son abonnement", () => {
    expect(
      subscriptionIdOf({
        type: "checkout.session.completed",
        data: { object: { mode: "subscription", subscription: "sub_1" } },
      }),
    ).toBe("sub_1");
    expect(
      subscriptionIdOf({
        type: "checkout.session.completed",
        data: { object: { mode: "payment", subscription: null } },
      }),
    ).toBeNull();
    expect(
      subscriptionIdOf({
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_2" } },
      }),
    ).toBe("sub_2");
    expect(
      subscriptionIdOf({
        type: "invoice.payment_failed",
        data: { object: { parent: { subscription_details: { subscription: "sub_3" } } } },
      }),
    ).toBe("sub_3");
    expect(
      subscriptionIdOf({
        type: "invoice.payment_failed",
        data: { object: { subscription: { id: "sub_4" } } },
      }),
    ).toBe("sub_4");
    expect(
      subscriptionIdOf({ type: "charge.succeeded", data: { object: { id: "ch_1" } } }),
    ).toBeNull();
  });
});

describe("droits du plan (PL-602)", () => {
  it("lecture seule : écritures métier bloquées, facturation, organisation et notifications ouvertes", async () => {
    const { blockedWhenReadOnly } = await import("@/server/services/billing-data");
    for (const path of [
      "system.create",
      "system.setMonitored",
      "classification.sign",
      "control.comment",
      "evidence.registerUpload",
      "exemption.save",
      "integration.jira.complete",
      "pack.create",
    ]) {
      expect(blockedWhenReadOnly(path), path).toBe(true);
    }
    for (const path of [
      "billing.checkout",
      "billing.portal",
      "org.update",
      "notification.markRead",
      "pack.download",
    ]) {
      expect(blockedWhenReadOnly(path), path).toBe(false);
    }
  });

  it("limites : systèmes surveillés et dépôts (illimité : null)", async () => {
    const { canLinkRepository, canMonitorAnother } = await import("@/server/services/billing-data");
    expect(canMonitorAnother(0, 1)).toBe(true);
    expect(canMonitorAnother(1, 1)).toBe(false);
    expect(canLinkRepository(9, 10)).toBe(true);
    expect(canLinkRepository(10, 10)).toBe(false);
    expect(canLinkRepository(500, null)).toBe(true);
  });
});
