// PL-403 — Connexion Jira sur base réelle, Atlassian simulé : intégration créée avec jetons chiffrés, state vérifié
// contre la session, site déjà lié ailleurs refusé, et le test exigé par le ticket : deux rafraîchissements concurrents
// n'invalident pas la connexion (verrou de ligne, jeton de rafraîchissement rotatif consommé une seule fois).
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKey, type MasterKey } from "@/server/crypto/envelope";
import { forOrg, prisma, withOrgTransaction } from "@/server/db";
import { signState } from "@/server/connectors/jira/oauth";
import {
  completeJiraAuthorization,
  jiraAccessToken,
  jiraGet,
  type JiraDependencies,
} from "@/server/services/jira-integration";
import type { OrgContext } from "@/server/services/organization";

const run = randomUUID().slice(0, 8);
const A = `org_jira_a_${run}`;
const B = `org_jira_b_${run}`;
const userA = `usr_jira_a_${run}`;
const userB = `usr_jira_b_${run}`;
const CLOUD = randomUUID();
const SECRET = "secret-etat-jira-0123456789-0123456789";
const master: MasterKey = { id: "test", key: generateKey() };

/** Atlassian simulé : codes à usage unique, jetons de rafraîchissement rotatifs (l'ancien devient invalide). */
class FakeAtlassian {
  clock = new Date("2026-11-12T12:00:00Z");
  validRefresh = new Set<string>();
  refreshCalls = 0;
  apiCalls: { url: string; auth: string }[] = [];
  private seq = 0;
  private codes = new Set<string>();

  issueCode() {
    const code = `code-${++this.seq}`;
    this.codes.add(code);
    return code;
  }

  private tokens() {
    const n = ++this.seq;
    const refresh = `refresh-${run}-${n}`;
    this.validRefresh.add(refresh);
    return {
      access_token: `access-${run}-${n}`,
      refresh_token: refresh,
      expires_in: 3600,
      scope: "read:jira-work read:jira-user manage:jira-webhook offline_access",
    };
  }

  fetch = (async (url: string, init: RequestInit = {}) => {
    if (url === "https://auth.atlassian.com/oauth/token") {
      const body = JSON.parse(init.body as string) as Record<string, string>;
      if (body.grant_type === "authorization_code") {
        if (!this.codes.delete(body.code!))
          return Response.json({ error: "invalid_grant" }, { status: 403 });
        return Response.json(this.tokens());
      }
      this.refreshCalls += 1;
      await new Promise((r) => setTimeout(r, 150));
      if (!this.validRefresh.delete(body.refresh_token!)) {
        return Response.json({ error: "invalid_grant" }, { status: 403 });
      }
      return Response.json(this.tokens());
    }
    if (url === "https://api.atlassian.com/oauth/token/accessible-resources") {
      return Response.json([
        {
          id: CLOUD,
          name: "talvio",
          url: "https://talvio.atlassian.net",
          scopes: ["read:jira-work", "read:jira-user", "manage:jira-webhook"],
        },
      ]);
    }
    if (url.startsWith("https://api.atlassian.com/ex/jira/")) {
      this.apiCalls.push({ url, auth: (init.headers as Record<string, string>).authorization! });
      return Response.json({ accountId: "abc" });
    }
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
}

const atlassian = new FakeAtlassian();
const deps: JiraDependencies = {
  fetch: atlassian.fetch,
  master,
  now: () => atlassian.clock,
  stateSecret: SECRET,
  client: {
    clientId: "id",
    clientSecret: "secret",
    redirectUri: "https://app/api/integrations/jira/callback",
  },
};

const ctxFor = (orgId: string, userId: string): OrgContext => ({
  headers: new Headers(),
  orgId,
  userId,
  role: "owner",
  db: forOrg(orgId),
});
const stateFor = (orgId: string, userId: string) =>
  signState({ orgId, userId }, SECRET, atlassian.clock);
let integrationId = "";

beforeAll(async () => {
  for (const org of [A, B])
    await prisma.organization.create({ data: { id: org, name: org, slug: org } });
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const org of [A, B]) {
      await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [org]);
      await client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [org]);
      await client.query(`DELETE FROM "Organization" WHERE id = $1`, [org]);
    }
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("connexion", () => {
  it("state d'un autre utilisateur, d'une autre organisation ou altéré → refus, rien n'est créé", async () => {
    for (const state of [stateFor(A, userB), stateFor(B, userA), `${stateFor(A, userA)}x`]) {
      const error = await completeJiraAuthorization(
        ctxFor(A, userA),
        { code: atlassian.issueCode(), state },
        deps,
      ).catch((e: Error) => e);
      expect((error as Error).message).toBe("integration.jira.invalidState");
    }
    expect(await forOrg(A).integration.count()).toBe(0);
  });

  it("code échangé, cloudId obtenu, intégration ACTIVE avec jetons chiffrés, connexion journalisée", async () => {
    const result = await completeJiraAuthorization(
      ctxFor(A, userA),
      { code: atlassian.issueCode(), state: stateFor(A, userA) },
      deps,
    );
    integrationId = result.integrationId;
    const row = await forOrg(A).integration.findUniqueOrThrow({ where: { id: integrationId } });
    expect(row).toMatchObject({
      provider: "JIRA",
      externalAccountId: CLOUD,
      externalAccountName: "talvio",
      status: "ACTIVE",
      createdByUserId: userA,
    });
    expect(row.scopes).toContain("offline_access");
    // Aucun jeton en clair en base.
    const stored = Buffer.from(row.credentialsCiphertext!).toString("latin1");
    expect(stored).not.toContain("access-");
    expect(stored).not.toContain("refresh-");
    const entry = await forOrg(A).auditLog.findFirstOrThrow({
      where: { action: "integration.connect" },
    });
    expect(entry.metadata).toMatchObject({ provider: "JIRA", cloudId: CLOUD, reconnected: false });
    expect(JSON.stringify(entry.metadata)).not.toMatch(/access-|refresh-/u);
  });

  it("un code déjà utilisé est refusé ; une reconnexion met à jour la même intégration", async () => {
    const code = atlassian.issueCode();
    await completeJiraAuthorization(ctxFor(A, userA), { code, state: stateFor(A, userA) }, deps);
    const error = await completeJiraAuthorization(
      ctxFor(A, userA),
      { code, state: stateFor(A, userA) },
      deps,
    ).catch((e: Error) => e);
    expect((error as Error).message).toBe("integration.jira.exchangeFailed");
    expect(await forOrg(A).integration.count()).toBe(1);
  });

  it("un site déjà relié à une autre organisation est refusé", async () => {
    const error = await completeJiraAuthorization(
      ctxFor(B, userB),
      { code: atlassian.issueCode(), state: stateFor(B, userB) },
      deps,
    ).catch((e: Error) => e);
    expect((error as Error).message).toBe("integration.jira.siteLinkedElsewhere");
    expect(await forOrg(B).integration.count()).toBe(0);
  });
});

describe("rafraîchissement", () => {
  it("jeton encore valide : aucun appel à Atlassian ; appel d'API par l'hôte fixe avec le jeton", async () => {
    const before = atlassian.refreshCalls;
    await jiraGet(A, integrationId, "/myself", deps);
    expect(atlassian.refreshCalls).toBe(before);
    expect(atlassian.apiCalls.at(-1)).toMatchObject({
      url: `https://api.atlassian.com/ex/jira/${CLOUD}/rest/api/3/myself`,
      auth: expect.stringMatching(/^Bearer access-/u),
    });
  });

  it("deux rafraîchissements concurrents n'invalident pas la connexion", async () => {
    // Le jeton d'accès expire : deux jobs en ont besoin en même temps.
    atlassian.clock = new Date(atlassian.clock.getTime() + 3600_000);
    const before = atlassian.refreshCalls;
    const [first, second] = await Promise.all([
      jiraAccessToken(A, integrationId, deps),
      jiraAccessToken(A, integrationId, deps),
    ]);
    // Le second a attendu le verrou puis relu le jeton déjà rafraîchi : un seul échange avec Atlassian.
    expect(atlassian.refreshCalls - before).toBe(1);
    expect(first.accessToken).toBe(second.accessToken);
    const row = await forOrg(A).integration.findUniqueOrThrow({ where: { id: integrationId } });
    expect(row.status).toBe("ACTIVE");
    // Le jeton de rafraîchissement courant reste utilisable : la connexion survit au rafraîchissement suivant.
    atlassian.clock = new Date(atlassian.clock.getTime() + 3600_000);
    await expect(jiraAccessToken(A, integrationId, deps)).resolves.toMatchObject({
      cloudId: CLOUD,
    });
  });

  it("jeton de rafraîchissement révoqué côté Atlassian → intégration REVOKED, plus aucun appel", async () => {
    atlassian.clock = new Date(atlassian.clock.getTime() + 3600_000);
    atlassian.validRefresh.clear();
    const error = await jiraAccessToken(A, integrationId, deps).catch((e: Error) => e);
    expect((error as Error).message).toBe("integration.jira.revoked");
    const row = await withOrgTransaction(A, (tx) =>
      tx.integration.findUniqueOrThrow({ where: { id: integrationId } }),
    );
    expect(row.status).toBe("REVOKED");
    expect(row.lastError).not.toMatch(/refresh-|access-/u);
    const calls = atlassian.refreshCalls;
    await expect(jiraAccessToken(A, integrationId, deps)).rejects.toThrow(
      "integration.jira.revoked",
    );
    expect(atlassian.refreshCalls).toBe(calls);
  });

  it("une intégration d'une autre organisation est introuvable (RLS)", async () => {
    await expect(jiraAccessToken(B, integrationId, deps)).rejects.toThrow("integration.notFound");
  });
});
