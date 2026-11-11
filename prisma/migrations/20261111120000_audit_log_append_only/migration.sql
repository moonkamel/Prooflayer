-- PL-106 : journal d'audit en ajout seul (§3.2 E10, §4.3.2 « Journal d'audit applicatif, en ajout seul »).
-- Le rôle applicatif n'a déjà ni UPDATE ni DELETE sur AuditLog (PL-102). Ce trigger, sur le modèle de evidence_guard
-- (§4.3.3), interdit aussi la modification et la suppression au propriétaire des tables. Seule exception : la purge
-- complète d'une organisation, lancée par le rôle propriétaire après avoir positionné app.purge_org (§4.7, PL-607).
CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.purge_org', true) = OLD."orgId" THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'AuditLog est en ajout seul';
  END IF;
  RAISE EXCEPTION 'AuditLog est en ajout seul : aucune modification';
END $$;

CREATE TRIGGER audit_log_guard
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
