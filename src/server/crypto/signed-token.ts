// Jetons signés sans état (HMAC-SHA256) : un objet JSON, un usage (`purpose`) et une échéance. Le secret est dérivé de
// BETTER_AUTH_SECRET par usage : un jeton émis pour un usage n'est jamais accepté pour un autre. Fonctions pures.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const keyFor = (secret: string, purpose: string) =>
  createHmac("sha256", secret).update(`prooflayer:token:${purpose}:v1`).digest();

export function signToken(
  claims: Record<string, unknown>,
  options: { secret: string; purpose: string; expiresAt: Date },
): string {
  const body = Buffer.from(
    JSON.stringify({
      ...claims,
      exp: options.expiresAt.getTime(),
      n: randomBytes(9).toString("base64url"),
    }),
  ).toString("base64url");
  const mac = createHmac("sha256", keyFor(options.secret, options.purpose))
    .update(body)
    .digest("base64url");
  return `${body}.${mac}`;
}

/** Claims du jeton, ou null s'il est altéré, mal formé, d'un autre usage ou expiré. */
export function verifyToken(
  token: string,
  options: { secret: string; purpose: string; now: Date },
): Record<string, unknown> | null {
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = createHmac("sha256", keyFor(options.secret, options.purpose))
    .update(body)
    .digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (typeof claims.exp !== "number" || claims.exp < options.now.getTime()) return null;
    return claims;
  } catch {
    return null;
  }
}

export function tokenSecret(env: Record<string, string | undefined> = process.env): string {
  if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET absent");
  return env.BETTER_AUTH_SECRET;
}
