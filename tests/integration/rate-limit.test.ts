// PL-605 — Limitation de débit sur base réelle : compteur atomique par fenêtre fixe (requêtes concurrentes comprises),
// remise à zéro à la fenêtre suivante, réponse 429 avec Retry-After ; webhook et API refusés au-delà de la règle,
// avant toute vérification de signature ou lecture de session ; IP jamais stockée en clair ; ménage quotidien.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  consume,
  ipKey,
  pruneRateLimits,
  RATE_RULES,
  type RateRule,
} from "@/server/system/rate-limit";

const run = randomUUID().slice(0, 8);
const rule: RateRule = { max: 3, windowMs: 60_000 };
const rules = RATE_RULES as unknown as Record<string, RateRule>;

afterAll(async () => {
  await prisma.rateLimit.deleteMany({ where: { key: { contains: run } } });
  await prisma.$disconnect();
});

describe("compteur", () => {
  it("permet max requêtes par fenêtre, puis refuse avec le délai restant ; nouvelle fenêtre : remis à zéro", async () => {
    const t0 = 1_800_000_000_000 - (1_800_000_000_000 % 60_000);
    const key = `test:${run}:a`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consume(key, rule, t0 + 1_000));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]).toMatchObject({ remaining: 0, retryAfter: 59 });
    expect(await consume(key, rule, t0 + 60_000)).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("atomique sous requêtes concurrentes", async () => {
    const key = `test:${run}:b`;
    const now = Date.now();
    const decisions = await Promise.all(Array.from({ length: 10 }, () => consume(key, rule, now)));
    expect(decisions.filter((d) => d.allowed)).toHaveLength(3);
  });

  it("IP jamais en clair ; ménage des compteurs de plus d'un jour", async () => {
    expect(ipKey("203.0.113.7")).not.toContain("203");
    const key = `test:${run}:old`;
    await consume(key, rule, Date.now() - 3 * 86_400_000);
    expect(await pruneRateLimits()).toBeGreaterThanOrEqual(1);
    expect(await prisma.rateLimit.count({ where: { key: `pl:${key}` } })).toBe(0);
  });
});

describe("routes", () => {
  const ip = (n: number) => `198.51.100.${n}-${run}`;

  it("webhook : 429 au-delà de la règle, avant la signature", async () => {
    const saved = rules.webhook;
    rules.webhook = { max: 2, windowMs: 60_000 };
    process.env.GITHUB_WEBHOOK_SECRET ??= "secret-rate";
    try {
      const { POST } = await import("@/app/api/webhooks/github/route");
      const send = () =>
        POST(
          new Request("https://app.example.test/api/webhooks/github", {
            method: "POST",
            body: "{}",
            headers: { "x-forwarded-for": ip(1), "x-hub-signature-256": "sha256=00" },
          }),
        );
      expect([(await send()).status, (await send()).status]).toEqual([400, 400]);
      const refused = await send();
      expect(refused.status).toBe(429);
      expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    } finally {
      rules.webhook = saved!;
    }
  });

  it("API : 429 au-delà de la règle, par adresse IP", async () => {
    const saved = rules.api;
    rules.api = { max: 1, windowMs: 60_000 };
    try {
      const { GET } = await import("@/app/api/trpc/[trpc]/route");
      const call = (n: number) =>
        GET(
          new Request("https://app.example.test/api/trpc/watch.list", {
            headers: { "x-forwarded-for": ip(n) },
          }),
        );
      expect((await call(2)).status).not.toBe(429);
      expect((await call(2)).status).toBe(429);
      expect((await call(3)).status).not.toBe(429);
    } finally {
      rules.api = saved!;
    }
  });
});
