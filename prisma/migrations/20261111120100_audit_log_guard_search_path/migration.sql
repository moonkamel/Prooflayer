-- PL-106 : search_path figé pour la fonction du trigger d'ajout seul (avis « function_search_path_mutable » de
-- Supabase). Sans cela, un rôle capable de modifier son search_path pourrait faire résoudre current_setting
-- vers une autre fonction.
ALTER FUNCTION audit_log_guard() SET search_path = pg_catalog, public;
