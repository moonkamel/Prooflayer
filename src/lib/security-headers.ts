// En-têtes de sécurité (PL-108, §4.7) : CSP avec nonce par requête (posée par src/proxy.ts), HSTS avec préchargement,
// interdiction d'intégration (`frame-ancestors 'none'`). Fonctions pures, testées par tests/unit/security-headers.test.ts.

/** Hôte d'ingestion Sentry en région UE (§4.2) : seule origine externe à laquelle le navigateur envoie des données. */
export const SENTRY_INGEST = "https://*.ingest.de.sentry.io";

/** Origine du stockage objet S3 (dépôt direct des preuves manuelles par le navigateur, PL-405), si configuré. */
export function storageOrigin(endpoint: string | undefined): string | null {
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(
  nonce: string,
  options: { dev: boolean; connect?: (string | null)[] },
): string {
  const connect = [`'self'`, SENTRY_INGEST, ...(options.connect ?? []).filter(Boolean)];
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' : seuls les scripts portant le nonce, et ceux qu'ils chargent, s'exécutent.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.dev ? " 'unsafe-eval'" : ""}`,
    // Attributs `style` de React : le nonce ne couvre pas les attributs, d'où 'unsafe-inline' pour les styles seuls.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(options.dev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

/** En-têtes fixes, posés sur toutes les réponses (next.config.ts). */
export const STATIC_SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];
