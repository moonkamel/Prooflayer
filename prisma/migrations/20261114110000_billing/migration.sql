-- PL-601 : abonnement Stripe. Livraisons de webhooks Stripe dans la boîte de réception (fournisseur STRIPE), champs de
-- l'abonnement relus auprès de Stripe, et essai de 14 jours pour toute organisation qui n'a pas encore d'abonnement.
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'STRIPE';

ALTER TABLE "Subscription"
  ADD COLUMN "priceId" TEXT,
  ADD COLUMN "billingInterval" TEXT,
  ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "syncedAt" TIMESTAMP(3);

INSERT INTO "Subscription" (id, "orgId", plan, status, "monitoredSystemsLimit", "trialEndsAt")
SELECT 'sub_' || md5(o.id), o.id, 'TRIAL', 'trialing', 1, o."createdAt" + interval '14 days'
FROM "Organization" o
WHERE NOT EXISTS (SELECT 1 FROM "Subscription" s WHERE s."orgId" = o.id);
