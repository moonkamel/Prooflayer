-- Retour arrière de 20261114110000_billing (PL-601).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261114110000_billing/down.sql
-- Les abonnements d'essai créés par la migration sont conservés (données métier).
ALTER TABLE "Subscription"
  DROP COLUMN IF EXISTS "priceId",
  DROP COLUMN IF EXISTS "billingInterval",
  DROP COLUMN IF EXISTS "cancelAtPeriodEnd",
  DROP COLUMN IF EXISTS "syncedAt";

-- Une valeur d'énumération ne se retire pas : le type est recréé sans STRIPE.
DELETE FROM "WebhookDelivery" WHERE provider = 'STRIPE';
ALTER TYPE "IntegrationProvider" RENAME TO "IntegrationProvider_old";
CREATE TYPE "IntegrationProvider" AS ENUM ('GITHUB', 'JIRA', 'GITLAB', 'NOTION', 'API');
ALTER TABLE "Integration" ALTER COLUMN provider TYPE "IntegrationProvider" USING provider::text::"IntegrationProvider";
ALTER TABLE "WebhookDelivery" ALTER COLUMN provider TYPE "IntegrationProvider" USING provider::text::"IntegrationProvider";
DROP FUNCTION IF EXISTS resolve_integration("IntegrationProvider_old", TEXT);
DROP TYPE "IntegrationProvider_old";

-- resolve_integration tel que l'a posé 20261112130000_resolve_integration (PL-302).
CREATE OR REPLACE FUNCTION resolve_integration(p_provider "IntegrationProvider", p_external_account_id TEXT)
RETURNS TABLE ("integrationId" TEXT, "orgId" TEXT, "status" "IntegrationStatus")
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT i.id, i."orgId", i.status
  FROM "Integration" i
  WHERE i.provider = p_provider AND i."externalAccountId" = p_external_account_id
$$;

REVOKE ALL ON FUNCTION resolve_integration("IntegrationProvider", TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_integration("IntegrationProvider", TEXT) TO prooflayer_app;

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261114110000_billing';
