// PL-601 — Abonnement Stripe sur base réelle, Stripe simulé (aucun appel réseau) : essai de 14 jours, session Checkout
// (owner seulement, organisation en métadonnées, essai reporté, TVA collectée), portail client ; webhook signé
// (`stripe.webhooks.constructEvent`), idempotent, relecture de l'abonnement auprès de Stripe. Événements figés de
// tests/fixtures/stripe/ : parcours essai → payant, changement de plan, impayé, résiliation, événement rejoué,
// événements reçus dans le désordre, abonnement sans organisation.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { forOrg, prisma } from "@/server/db";
import { processDelivery } from "@/server/ingest/process-delivery";
import { createCaller } from "@/server/routers/_app";
import { priceConfig, type StripeSubscriptionLike } from "@/server/services/billing-data";
import { billingDependencies, type BillingDependencies } from "@/server/services/billing";

const run = randomUUID().slice(0, 8);
const A = `org_bill_${run}`;
const owner = `usr_bill_owner_${run}`;
const admin = `usr_bill_admin_${run}`;
const SECRET = "whsec_test_secret_billing";
const stripeSdk = new Stripe("sk_test_unused");
let POST: (req: Request) => Promise<Response>;
const now = new Date();

/** État des abonnements « chez Stripe », relu par le service à chaque événement. */
const remote = new Map<string, StripeSubscriptionLike>();
const checkouts: Stripe.Checkout.SessionCreateParams[] = [];
const retrieve = vi.fn(async (id: string) => {
  const sub = remote.get(id);
  if (!sub) throw new Error("No such subscription");
  return sub;
});

const deps: BillingDependencies = {
  stripe: () => ({
    checkout: {
      sessions: {
        create: async (params) => {
          checkouts.push(params);
          return { url: "https://checkout.stripe.test/c/pay/cs_test_1" };
        },
      },
    },
    billingPortal: {
      sessions: { create: async () => ({ url: "https://billing.stripe.test/p/session" }) },
    },
    subscriptions: { retrieve },
  }),
  config: () =>
    priceConfig({
      STRIPE_PRICE_STARTER_MONTH: "price_starter_month",
      STRIPE_PRICE_GROWTH_YEAR: "price_growth_year",
      STRIPE_PRICE_SCALE_YEAR: "price_scale_year",
    }),
  baseUrl: "https://app.example.test",
  automaticTax: false,
  paymentMethodConfiguration: null,
  now: () => now,
};

const as = (userId: string) =>
  createCaller({ headers: new Headers(), session: { userId, activeOrganizationId: A } });

function fixture(name: string, orgId = A) {
  const text = readFileSync(join(process.cwd(), "tests/fixtures/stripe", `${name}.json`), "utf8");
  // Identifiant d'événement propre à l'exécution : la boîte de réception est partagée entre exécutions.
  return JSON.parse(
    text.replaceAll("__ORG__", orgId).replace(/"id": "evt_([a-z_]+)"/u, `"id": "evt_$1_${run}"`),
  );
}

function signed(body: string, secret = SECRET) {
  const header = stripeSdk.webhooks.generateTestHeaderString({ payload: body, secret });
  return new Request("https://app.example.test/api/webhooks/stripe", {
    method: "POST",
    body,
    headers: { "stripe-signature": header, "content-type": "application/json" },
  });
}

/** Le traitement lancé par waitUntil peut tourner en parallèle : on le rejoue puis on attend sa fin. */
async function deliverUntil(event: { id: string }, done: (status: string) => boolean) {
  const response = await POST(signed(JSON.stringify(event)));
  await processDelivery("STRIPE", event.id);
  for (let i = 0; i < 50; i++) {
    const d = await prisma.webhookDelivery.findFirst({
      where: { provider: "STRIPE", deliveryId: event.id },
    });
    if (d && done(d.status)) return { response, delivery: d };
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("livraison non traitée");
}
const deliver = (event: { id: string }) =>
  deliverUntil(event, (status) => status !== "PENDING" && status !== "PROCESSING");

const subscription = () => forOrg(A).subscription.findUniqueOrThrow({ where: { orgId: A } });
const ts = (d: Date) => Math.floor(d.getTime() / 1000);

beforeAll(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_SECRET_KEY = "sk_test_unused";
  billingDependencies.get = () => deps;
  ({ POST } = await import("@/app/api/webhooks/stripe/route"));
  await prisma.organization.create({ data: { id: A, name: "Talvio", slug: A } });
  for (const [id, role] of [
    [owner, "owner"],
    [admin, "admin"],
  ] as const) {
    await prisma.user.create({ data: { id, email: `${id}@bill.test`, name: role } });
    await prisma.member.create({ data: { id: `mem_${id}`, organizationId: A, userId: id, role } });
  }
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `DELETE FROM "WebhookDelivery" WHERE provider = 'STRIPE' AND "deliveryId" LIKE $1`,
      [`%${run}`],
    );
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [A]);
    await client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "Organization" WHERE id = $1`, [A]);
    await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[owner, admin]]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("essai et souscription", () => {
  it("essai de 14 jours, sans carte, 1 système surveillé ; formules configurées proposées", async () => {
    const billing = await as(admin).billing.get();
    expect(billing).toMatchObject({
      plan: "TRIAL",
      monitoredSystemsLimit: 1,
      hasCustomer: false,
      access: { kind: "trial", daysLeft: 14 },
    });
    expect(billing.offers).toEqual([
      { plan: "STARTER", interval: "month" },
      { plan: "GROWTH", interval: "year" },
      { plan: "SCALE", interval: "year" },
    ]);
  });

  it("Checkout : owner seulement ; organisation en métadonnées, essai reporté, TVA et adresse collectées", async () => {
    await expect(
      as(admin).billing.checkout({ plan: "GROWTH", interval: "year", locale: "fr" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      as(owner).billing.checkout({ plan: "GROWTH", interval: "month", locale: "fr" }),
    ).rejects.toThrow("billing.offerUnavailable");
    const { url } = await as(owner).billing.checkout({
      plan: "GROWTH",
      interval: "year",
      locale: "fr",
    });
    expect(url).toBe("https://checkout.stripe.test/c/pay/cs_test_1");
    const params = checkouts.at(-1)!;
    const trialEndsAt = (await subscription()).trialEndsAt!;
    expect(params).toMatchObject({
      mode: "subscription",
      line_items: [{ price: "price_growth_year", quantity: 1 }],
      client_reference_id: A,
      metadata: { orgId: A },
      subscription_data: { metadata: { orgId: A }, trial_end: ts(trialEndsAt) },
      customer_email: `${owner}@bill.test`,
      tax_id_collection: { enabled: true },
      billing_address_collection: "required",
      success_url: "https://app.example.test/organization/billing?checkout=success",
    });
    expect(await forOrg(A).auditLog.count({ where: { action: "billing.checkout" } })).toBe(1);
  });
});

describe("webhook Stripe", () => {
  it("signature invalide : 400 ; sans secret : 503 ; événement non suivi : 200 sans enregistrement", async () => {
    const body = JSON.stringify(fixture("checkout-completed"));
    expect((await POST(signed(body, "whsec_autre"))).status).toBe(400);
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect((await POST(signed(body))).status).toBe(503);
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    const other = JSON.stringify({
      ...fixture("checkout-completed"),
      id: `evt_charge_${run}`,
      type: "charge.succeeded",
    });
    expect((await POST(signed(other))).status).toBe(200);
    expect(await prisma.webhookDelivery.count({ where: { deliveryId: `evt_charge_${run}` } })).toBe(
      0,
    );
  });

  it("essai → payant : Checkout terminé, abonnement relu chez Stripe, sans charge en base", async () => {
    const periodEnd = new Date(Date.now() + 365 * 86_400_000);
    remote.set("sub_test_1", {
      id: "sub_test_1",
      status: "trialing",
      customer: "cus_test_1",
      metadata: { orgId: A },
      trial_end: ts((await subscription()).trialEndsAt!),
      items: { data: [{ price: { id: "price_growth_year" }, current_period_end: ts(periodEnd) }] },
    });
    const event = fixture("checkout-completed");
    const { response, delivery } = await deliver(event);
    expect(response.status).toBe(200);
    expect(delivery.status).toBe("PROCESSED");
    expect(JSON.stringify(delivery.payload)).not.toContain("facturation@example.test");
    expect(await subscription()).toMatchObject({
      plan: "GROWTH",
      status: "trialing",
      stripeCustomerId: "cus_test_1",
      stripeSubscriptionId: "sub_test_1",
      billingInterval: "year",
      monitoredSystemsLimit: 5,
    });
    expect((await as(owner).billing.get()).access).toEqual({ kind: "active" });
    // Un abonnement vivant se modifie dans le portail, jamais par un second Checkout.
    await expect(
      as(owner).billing.checkout({ plan: "SCALE", interval: "year", locale: "fr" }),
    ).rejects.toThrow("billing.alreadySubscribed");
    expect(await as(owner).billing.portal()).toEqual({
      url: "https://billing.stripe.test/p/session",
    });
  });

  it("événement rejoué : 200, aucun second traitement", async () => {
    retrieve.mockClear();
    const event = fixture("checkout-completed");
    const response = await POST(signed(JSON.stringify(event)));
    expect(response.status).toBe(200);
    await processDelivery("STRIPE", event.id);
    expect(retrieve).not.toHaveBeenCalled();
    expect(await prisma.webhookDelivery.count({ where: { deliveryId: event.id } })).toBe(1);
  });

  it("changement de plan, puis impayé : la limite suit le plan ; past_due → lecture seule", async () => {
    remote.set("sub_test_1", {
      ...remote.get("sub_test_1")!,
      status: "active",
      items: {
        data: [
          {
            price: { id: "price_scale_year" },
            current_period_end: remote.get("sub_test_1")!.items.data[0]!.current_period_end,
          },
        ],
      },
    });
    await deliver(fixture("subscription-updated-plan"));
    expect(await subscription()).toMatchObject({
      plan: "SCALE",
      status: "active",
      monitoredSystemsLimit: 20,
    });
    remote.set("sub_test_1", { ...remote.get("sub_test_1")!, status: "past_due" });
    await deliver(fixture("invoice-payment-failed"));
    expect((await subscription()).status).toBe("past_due");
    expect((await as(owner).billing.get()).access).toMatchObject({
      kind: "readOnly",
      reason: "pastDue",
    });
    const logs = await forOrg(A).auditLog.findMany({
      where: { action: "billing.subscriptionSynced" },
    });
    expect(logs.map((l) => (l.metadata as { status: string }).status)).toEqual([
      "trialing",
      "active",
      "past_due",
    ]);
  });

  it("dans le désordre : un « updated » ancien reçu après la résiliation n'en défait rien", async () => {
    remote.set("sub_test_1", {
      ...remote.get("sub_test_1")!,
      status: "canceled",
      cancel_at_period_end: false,
    });
    await deliver(fixture("subscription-deleted"));
    expect((await subscription()).status).toBe("canceled");
    // Le même « updated » (plan Scale, actif) rejoué sous un autre identifiant, arrivé en retard.
    const late = { ...fixture("subscription-updated-plan"), id: `evt_late_${run}` };
    await deliver(late);
    expect((await subscription()).status).toBe("canceled");
    expect((await as(owner).billing.get()).access).toMatchObject({
      kind: "readOnly",
      reason: "canceled",
    });
  });

  it("nouvel abonnement après résiliation ; l'ancien, reçu en retard, ne l'écrase pas", async () => {
    remote.set("sub_test_2", {
      id: "sub_test_2",
      status: "active",
      customer: "cus_test_1",
      metadata: { orgId: A },
      items: {
        data: [
          {
            price: { id: "price_starter_month" },
            current_period_end: ts(new Date(Date.now() + 30 * 86_400_000)),
          },
        ],
      },
    });
    await deliver({
      ...fixture("subscription-updated-plan"),
      id: `evt_new_${run}`,
      data: { object: { id: "sub_test_2" } },
    });
    expect(await subscription()).toMatchObject({
      plan: "STARTER",
      stripeSubscriptionId: "sub_test_2",
      monitoredSystemsLimit: 1,
    });
    const { delivery } = await deliver({
      ...fixture("subscription-deleted"),
      id: `evt_old_${run}`,
    });
    expect(delivery.status).toBe("IGNORED");
    expect(await subscription()).toMatchObject({
      stripeSubscriptionId: "sub_test_2",
      status: "active",
    });
  });

  it("abonnement sans organisation : consigné, 200, ignoré ; Stripe indisponible : nouvel essai", async () => {
    remote.set("sub_test_orphan", {
      id: "sub_test_orphan",
      status: "active",
      customer: "cus_x",
      metadata: {},
      items: { data: [{ price: { id: "price_growth_year" } }] },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { response, delivery } = await deliver(fixture("subscription-created-no-org"));
    expect(response.status).toBe(200);
    expect(delivery.status).toBe("IGNORED");
    expect(error.mock.calls.some(([line]) => String(line).includes("billing.orgMissing"))).toBe(
      true,
    );
    error.mockRestore();
    retrieve.mockRejectedValueOnce(new Error("Stripe indisponible"));
    const event = { ...fixture("subscription-updated-plan"), id: `evt_retry_${run}` };
    const { delivery: pending } = await deliverUntil(event, (status) => status !== "PROCESSING");
    expect(pending).toMatchObject({ status: "PENDING", attempts: 1 });
  });
});
