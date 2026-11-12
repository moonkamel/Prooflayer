-- PL-302 : un webhook arrive sans organisation ; il faut retrouver celle qui a lié le compte externe (installation
-- GitHub, site Jira). `Integration` étant protégée par RLS forcé, cette fonction, propriété du rôle de migration,
-- ne fait que cette recherche par clé unique (provider, externalAccountId) et ne renvoie que des identifiants.
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
