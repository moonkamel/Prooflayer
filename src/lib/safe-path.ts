// Chemin de retour après connexion ou inscription (?next=…). Seuls les chemins internes sont acceptés,
// pour qu'un lien piégé ne puisse pas rediriger vers un autre site (redirection ouverte).
export function safePath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/u.test(value)) return fallback;
  return value;
}
