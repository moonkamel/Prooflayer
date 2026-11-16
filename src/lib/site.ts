// Adresse publique du site (SEO : canonique, sitemap, Open Graph, données structurées). BETTER_AUTH_URL est l'origine
// de production ; hors production, la page reste servie mais n'est jamais indexée (voir src/app/robots.ts).
export function siteUrl(env: Record<string, string | undefined> = process.env): URL {
  return new URL(env.BETTER_AUTH_URL ?? "http://localhost:3000");
}

/** Indexation autorisée seulement en production Vercel (jamais les prévisualisations). */
export function indexable(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

/** Pages publiques indexées, par ordre d'importance (sitemap). */
export const PUBLIC_PAGES = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/classifier", priority: 0.9, changeFrequency: "monthly" },
  { path: "/verify", priority: 0.6, changeFrequency: "monthly" },
  { path: "/trust", priority: 0.6, changeFrequency: "monthly" },
  { path: "/legal/terms", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/dpa", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/privacy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/notice", priority: 0.2, changeFrequency: "yearly" },
] as const;

/** Espaces privés ou de parcours, jamais indexés. */
export const PRIVATE_PREFIXES = [
  "/api/",
  "/dashboard",
  "/systems",
  "/organization",
  "/notifications",
  "/account",
  "/audit",
  "/watch",
  "/onboarding",
  "/setup-two-factor",
  "/two-factor",
  "/accept-invitation",
  "/reset-password",
  "/forgot-password",
  "/verify-email",
] as const;
