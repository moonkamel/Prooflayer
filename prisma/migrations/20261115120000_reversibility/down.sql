-- Retour arrière de PL-607.
DROP FUNCTION IF EXISTS purge_organization(TEXT);
DROP TABLE IF EXISTS "OrganizationDeletion";
DROP TABLE IF EXISTS "OrgExport";
DROP TYPE IF EXISTS "ExportStatus";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261115120000_reversibility';
