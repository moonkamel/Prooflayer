-- PL-204 : signature d'une classification (§3.2 E1 : « signée par un utilisateur nommé (nom, fonction, date,
-- déclaration). Une classification signée est immuable ; une modification crée une nouvelle version. »)
ALTER TABLE "Classification" ADD COLUMN "signedByName" TEXT;

-- Immuabilité, sur le modèle de audit_log_guard (PL-106) : une classification signée ne change plus, sauf son
-- passage à SUPERSEDED quand une nouvelle version est signée ; une classification remplacée ne change plus du tout.
-- Suppression d'une version signée ou remplacée : seulement lors de la purge d'une organisation (app.purge_org).
CREATE OR REPLACE FUNCTION classification_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'DRAFT' OR current_setting('app.purge_org', true) = OLD."orgId" THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Classification signée : suppression interdite';
  END IF;
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'SIGNED' AND NEW.status = 'SUPERSEDED'
     AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Classification signée : aucune modification';
END $$;

CREATE TRIGGER classification_guard
  BEFORE UPDATE OR DELETE ON "Classification"
  FOR EACH ROW EXECUTE FUNCTION classification_guard();
