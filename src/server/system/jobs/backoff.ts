// Réessais (§4.5.3) : « 8 tentatives, attente exponentielle avec aléa (30 s, 1 min, 2 min… plafonnée à 1 h) ».
export const MAX_ATTEMPTS = 8;
const BASE_MS = 30_000;
const CAP_MS = 60 * 60_000;
const JITTER = 0.1;

/**
 * Délai avant la tentative suivante, après l'échec de la tentative `attempt` (1 pour la première).
 * Aléa de ±10 % pour étaler les reprises ; jamais au-delà d'une heure.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponential = BASE_MS * 2 ** Math.max(0, attempt - 1);
  const jittered = Math.min(exponential, CAP_MS) * (1 - JITTER + 2 * JITTER * random());
  return Math.round(Math.min(jittered, CAP_MS));
}
