// Authentification des webhooks Jira d'une application OAuth 2.0 (PL-404, §4.5.2). HYPOTHÈSE À VALIDER du cahier : un
// JWT HS256 signé avec le secret client, dans l'en-tête `Authorization` (« JWT … » ou « Bearer … »). Vérifié en temps
// constant ; un jeton expiré est refusé. Fonction pure.
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyJiraWebhookJwt(
  authorization: string | null,
  secret: string,
  now: Date,
): Record<string, unknown> | null {
  const token = authorization?.match(/^(?:JWT|Bearer)\s+(\S+)$/u)?.[1];
  if (!token) return null;
  const [header, payload, signature, extra] = token.split(".");
  if (!header || !payload || !signature || extra !== undefined) return null;
  try {
    const head = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: string };
    if (head.alg !== "HS256") return null;
    const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (typeof claims.exp === "number" && claims.exp * 1000 < now.getTime()) return null;
    return claims;
  } catch {
    return null;
  }
}
