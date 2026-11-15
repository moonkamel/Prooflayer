// Limitation de débit de ProofLayer (PL-605, §4.7) : fenêtre fixe, compteur atomique en base (table `RateLimit`,
// partagée avec Better Auth). Une seule requête SQL par appel : `INSERT … ON CONFLICT DO UPDATE … RETURNING`. Les clés
// commencent par `pl:` et ne contiennent ni identifiant personnel en clair ni jeton : l'IP est hachée (HMAC).
import { createHmac, randomUUID } from "node:crypto";
import { prisma } from "@/server/db";

export interface RateRule {
  /** Requêtes permises par fenêtre. */
  max: number;
  windowMs: number;
}

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  /** Secondes avant la prochaine fenêtre, si refusé. */
  retryAfter: number;
}

/** Règles (§4.7 « limitation de débit sur l'authentification, les webhooks et l'API »). */
export const RATE_RULES = {
  /** API tRPC, par adresse IP. */
  api: { max: 600, windowMs: 60_000 },
  /** Webhooks entrants, par fournisseur et adresse IP (rafales de GitHub au rattrapage). */
  webhook: { max: 1_200, windowMs: 60_000 },
} as const satisfies Record<string, RateRule>;

/** Empreinte d'une adresse IP pour une clé de limitation : jamais l'adresse en clair en base. */
export function ipKey(
  ip: string,
  secret = process.env.BETTER_AUTH_SECRET ?? "prooflayer-dev-secret",
) {
  return createHmac("sha256", secret).update(`rate:${ip}`).digest("hex").slice(0, 32);
}

export async function consume(
  key: string,
  rule: RateRule,
  now = Date.now(),
): Promise<RateDecision> {
  const windowStart = now - (now % rule.windowMs);
  const rows = await prisma.$queryRaw<{ count: number; lastRequest: bigint }[]>`
    INSERT INTO "RateLimit" (id, key, count, "lastRequest")
    VALUES (${randomUUID()}, ${`pl:${key}`}, 1, ${BigInt(windowStart)})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN "RateLimit"."lastRequest" < ${BigInt(windowStart)} THEN 1 ELSE "RateLimit".count + 1 END,
      "lastRequest" = GREATEST("RateLimit"."lastRequest", ${BigInt(windowStart)})
    RETURNING count, "lastRequest"`;
  const count = rows[0]?.count ?? 1;
  const allowed = count <= rule.max;
  return {
    allowed,
    remaining: Math.max(0, rule.max - count),
    retryAfter: allowed ? 0 : Math.max(1, Math.ceil((windowStart + rule.windowMs - now) / 1000)),
  };
}

/** Réponse 429 (sans détail) avec `Retry-After`. */
export function tooManyRequests(decision: RateDecision): Response {
  return new Response(JSON.stringify({ error: "too_many_requests" }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(decision.retryAfter) },
  });
}

/** Ménage quotidien : compteurs de ProofLayer vieux de plus d'un jour (Better Auth purge les siens). */
export async function pruneRateLimits(now = Date.now()) {
  const { count } = await prisma.rateLimit.deleteMany({
    where: { key: { startsWith: "pl:" }, lastRequest: { lt: BigInt(now - 86_400_000) } },
  });
  return count;
}

/** Adresse du client, telle que transmise par Vercel (premier élément de x-forwarded-for). */
export function requestIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown"
  );
}
