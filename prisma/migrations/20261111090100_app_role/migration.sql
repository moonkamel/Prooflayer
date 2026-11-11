-- PL-102 : rôle applicatif sans BYPASSRLS, distinct du rôle de migration (§4.3.3, risque principal du §9.3).
--
-- Les migrations tournent sous le rôle de migration (propriétaire des tables : « postgres » chez Supabase).
-- L'application se connecte sous « prooflayer_app » : ni propriétaire des tables, ni BYPASSRLS, ni superutilisateur.
-- Le rôle est créé sans mot de passe : il ne peut pas se connecter tant que l'exploitant n'en a pas défini un
-- (ALTER ROLE prooflayer_app PASSWORD '…' dans l'éditeur SQL de Supabase). Aucun secret dans le dépôt.

-- CREATE ROLE donne par défaut NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS. Ces attributs ne se
-- réaffirment pas par ALTER ROLE : chez Supabase, le rôle de migration n'est pas superutilisateur et ne peut pas les
-- modifier. La migration vérifie donc qu'ils sont bien absents et échoue sinon (cas d'un rôle préexistant).
DO $$
DECLARE
  bad record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prooflayer_app') THEN
    CREATE ROLE prooflayer_app LOGIN;
  END IF;

  SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls INTO bad
  FROM pg_roles WHERE rolname = 'prooflayer_app';
  IF bad.rolsuper OR bad.rolcreatedb OR bad.rolcreaterole OR bad.rolreplication OR bad.rolbypassrls THEN
    RAISE EXCEPTION 'prooflayer_app a un attribut interdit (SUPERUSER, CREATEDB, CREATEROLE, REPLICATION ou BYPASSRLS)';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO prooflayer_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO prooflayer_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prooflayer_app;

-- Tables créées plus tard par le rôle de migration : mêmes droits par défaut.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO prooflayer_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO prooflayer_app;

-- Tables en ajout seul : le rôle applicatif ne supprime pas (§4.7 : « rôle applicatif sans droit de suppression »).
-- EvidenceItem : seule la purge d'une organisation, lancée par le rôle propriétaire, supprime (§4.3.3).
-- Ses mises à jour (scellement, effacement) restent permises ici ; le trigger du §4.3.3 (PL-304) les restreint.
REVOKE DELETE ON "EvidenceItem" FROM prooflayer_app;
-- AuditLog : journal d'audit en ajout seul (§4.3.2, PL-106).
REVOKE UPDATE, DELETE ON "AuditLog" FROM prooflayer_app;

-- Supabase expose le schéma public via son API de données aux rôles anon et authenticated.
-- ProofLayer n'utilise pas cette API : tout passe par le rôle applicatif. Tant que RLS n'est pas en place (PL-105),
-- ces rôles ne doivent rien pouvoir lire. Sans effet sur un Postgres sans ces rôles (CI, poste local).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;
