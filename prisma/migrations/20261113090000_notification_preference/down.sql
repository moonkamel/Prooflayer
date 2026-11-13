-- Retour arrière de 20261113090000_notification_preference (PL-408).
-- À exécuter avec le rôle de migration :
--   pnpm exec prisma db execute --file prisma/migrations/20261113090000_notification_preference/down.sql
DROP TABLE IF EXISTS "NotificationPreference";

-- Historique Prisma
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261113090000_notification_preference';
