// Authentification des routes /api/cron/* (§4.4.1) : en-tête « Authorization: Bearer $CRON_SECRET »,
// comparaison en temps constant. Sans secret configuré, toute requête est refusée.
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

export function isAuthorizedCron(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || secret.length < 32 || !authorization) return false;
  // Empreintes de même longueur : la comparaison ne révèle pas la longueur attendue.
  return timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}
