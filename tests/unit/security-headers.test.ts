// PL-108 — En-têtes de sécurité : CSP stricte à nonce, HSTS préchargé, intégration interdite.
import { describe, expect, it } from "vitest";
import {
  contentSecurityPolicy,
  STATIC_SECURITY_HEADERS,
  storageOrigin,
} from "@/lib/security-headers";

describe("en-têtes de sécurité", () => {
  it("CSP de production : nonce, strict-dynamic, frame-ancestors 'none', sans unsafe-eval", () => {
    const csp = contentSecurityPolicy("abc123", { dev: false });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/u);
    expect(csp).toContain("connect-src 'self' https://*.ingest.de.sentry.io");
  });

  it("CSP de développement : unsafe-eval pour React, pas de passage forcé en HTTPS", () => {
    const csp = contentSecurityPolicy("n", { dev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("HSTS de deux ans avec préchargement, X-Frame-Options DENY", () => {
    const byKey = Object.fromEntries(STATIC_SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains; preload");
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
  });
});

describe("dépôt direct vers le stockage (PL-405)", () => {
  it("l'origine S3 configurée s'ajoute à connect-src, rien d'autre", () => {
    const origin = storageOrigin("https://ref.storage.supabase.co/storage/v1/s3");
    expect(origin).toBe("https://ref.storage.supabase.co");
    expect(contentSecurityPolicy("n", { dev: false, connect: [origin] })).toContain(
      "connect-src 'self' https://*.ingest.de.sentry.io https://ref.storage.supabase.co",
    );
    expect(storageOrigin(undefined)).toBeNull();
    expect(storageOrigin("http://insecure.example")).toBeNull();
    expect(storageOrigin("pas une url")).toBeNull();
  });
});
