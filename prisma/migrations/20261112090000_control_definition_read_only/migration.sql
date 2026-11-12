-- PL-206 : la bibliothèque de contrôles est un référentiel commun à toutes les organisations (table système, sans
-- RLS). Le rôle applicatif la lit mais ne l'écrit pas : elle est publiée par `pnpm controls:sync`, sous le rôle de
-- migration, au déploiement. Une organisation ne peut donc pas altérer le référentiel des autres.
REVOKE INSERT, UPDATE, DELETE ON "ControlDefinition" FROM prooflayer_app;
