// PL-403 — OAuth 2.0 (3LO) Atlassian : state signé, adresse de consentement, échange et rafraîchissement des jetons,
// sites accessibles, adresses d'API sans surface SSRF.
import { describe, expect, it } from "vitest";
import {
  accessibleResources,
  authorizeUrl,
  exchangeCode,
  jiraApiUrl,
  JiraOAuthError,
  refreshTokens,
  signState,
  STATE_TTL_MS,
  usableSites,
  verifyState,
} from "@/server/connectors/jira/oauth";
import { jiraReturnPath, parseJiraStatus } from "@/lib/integration-status";

const SECRET = "secret-de-test-0123456789-0123456789";
const now = new Date("2026-11-12T12:00:00Z");
const client = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://app.example/api/integrations/jira/callback",
};
const CLOUD = "11111111-2222-4333-8444-555555555555";

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("state signé", () => {
  it("porte l'organisation et l'utilisateur, valable 10 minutes", () => {
    const state = signState({ orgId: "org_a", userId: "usr_a" }, SECRET, now);
    expect(verifyState(state, SECRET, now)).toEqual({ orgId: "org_a", userId: "usr_a" });
    expect(verifyState(state, SECRET, new Date(now.getTime() + STATE_TTL_MS - 1))).not.toBeNull();
    expect(verifyState(state, SECRET, new Date(now.getTime() + STATE_TTL_MS + 1))).toBeNull();
  });

  it("refuse un state altéré, signé par un autre secret ou mal formé ; deux states diffèrent", () => {
    const state = signState({ orgId: "org_a", userId: "usr_a" }, SECRET, now);
    const [body, mac] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ orgId: "org_b", userId: "usr_a", exp: 9e15 }));
    expect(verifyState(`${forged.toString("base64url")}.${mac}`, SECRET, now)).toBeNull();
    expect(verifyState(state, "autre-secret-0123456789-0123456789", now)).toBeNull();
    expect(verifyState(`${body}`, SECRET, now)).toBeNull();
    expect(verifyState(`${body}.${mac}.x`, SECRET, now)).toBeNull();
    expect(verifyState("", SECRET, now)).toBeNull();
    expect(signState({ orgId: "o", userId: "u" }, SECRET, now)).not.toBe(
      signState({ orgId: "o", userId: "u" }, SECRET, now),
    );
  });
});

describe("consentement et jetons", () => {
  it("adresse de consentement : audience, portées en lecture seule plus webhooks et offline_access, prompt=consent", () => {
    const url = new URL(authorizeUrl(client, "etat"));
    expect(url.origin + url.pathname).toBe("https://auth.atlassian.com/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      audience: "api.atlassian.com",
      client_id: "client-id",
      scope: "read:jira-work read:jira-user manage:jira-webhook offline_access",
      redirect_uri: client.redirectUri,
      state: "etat",
      response_type: "code",
      prompt: "consent",
    });
  });

  it("échange du code puis rafraîchissement : corps attendus, expiration calculée", async () => {
    const { fn, calls } = fakeFetch(() =>
      Response.json({
        access_token: "acc",
        refresh_token: "ref",
        expires_in: 3600,
        scope: "read:jira-work",
      }),
    );
    const tokens = await exchangeCode(fn, client, "code-1", now);
    expect(tokens).toEqual({
      accessToken: "acc",
      refreshToken: "ref",
      expiresAt: "2026-11-12T13:00:00.000Z",
      scopes: ["read:jira-work"],
    });
    expect(calls[0]!.url).toBe("https://auth.atlassian.com/oauth/token");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      grant_type: "authorization_code",
      client_id: "client-id",
      client_secret: "client-secret",
      code: "code-1",
      redirect_uri: client.redirectUri,
    });
    await refreshTokens(fn, client, "ref-0", now);
    expect(JSON.parse(calls[1]!.init.body as string)).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "ref-0",
    });
  });

  it("jeton refusé → invalid_grant ; autre erreur → http ; jamais le jeton dans le message", async () => {
    const refused = fakeFetch(() => Response.json({ error: "invalid_grant" }, { status: 400 }));
    const error = await refreshTokens(refused.fn, client, "jeton-secret", now).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(JiraOAuthError);
    expect((error as JiraOAuthError).kind).toBe("invalid_grant");
    expect((error as Error).message).not.toContain("jeton-secret");
    const down = fakeFetch(() => new Response("indisponible", { status: 503 }));
    expect(
      ((await refreshTokens(down.fn, client, "r", now).catch((e: unknown) => e)) as JiraOAuthError)
        .kind,
    ).toBe("http");
    const odd = fakeFetch(() => Response.json({ access_token: "a" }));
    expect(
      ((await exchangeCode(odd.fn, client, "c", now).catch((e: unknown) => e)) as JiraOAuthError)
        .kind,
    ).toBe("invalid_response");
  });

  it("sites accessibles : seuls ceux qui portent les portées requises sont utilisables", async () => {
    const full = {
      id: CLOUD,
      name: "talvio",
      url: "https://talvio.atlassian.net",
      scopes: ["read:jira-work", "read:jira-user", "manage:jira-webhook"],
    };
    const partial = {
      ...full,
      id: "99999999-2222-4333-8444-555555555555",
      scopes: ["read:jira-work"],
    };
    const { fn, calls } = fakeFetch(() => Response.json([full, partial]));
    const sites = await accessibleResources(fn, "acc");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer acc");
    expect(usableSites(sites).map((s) => s.id)).toEqual([CLOUD]);
  });
});

describe("adresses d'API (pas de surface SSRF)", () => {
  it("hôte Atlassian fixe, cloudId UUID, chemin relatif contrôlé", () => {
    expect(jiraApiUrl(CLOUD, "/myself")).toBe(
      `https://api.atlassian.com/ex/jira/${CLOUD}/rest/api/3/myself`,
    );
    expect(jiraApiUrl(CLOUD, "/issue/AIR-1?expand=changelog")).toContain(
      "/issue/AIR-1?expand=changelog",
    );
    expect(() => jiraApiUrl("evil.example", "/myself")).toThrow();
    for (const path of ["myself", "//evil.example/x", "/../admin", "@evil.example", "/x#y"]) {
      expect(() => jiraApiUrl(CLOUD, path), path).toThrow();
    }
  });
});

describe("retour vers la page Organisation", () => {
  it("clés fermées, jamais un message brut", () => {
    expect(jiraReturnPath("connected")).toBe("/organization?jira=connected");
    expect(jiraReturnPath("integration.jira.siteLinkedElsewhere")).toBe(
      "/organization?jira=siteLinkedElsewhere",
    );
    expect(jiraReturnPath("FORBIDDEN")).toBe("/organization?jira=forbidden");
    expect(jiraReturnPath("<script>")).toBe("/organization?jira=error");
    expect(parseJiraStatus("connected")).toBe("connected");
    expect(parseJiraStatus("autre")).toBeNull();
    expect(parseJiraStatus(undefined)).toBeNull();
  });
});
