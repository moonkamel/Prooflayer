// OAuth 2.0 (3LO) Atlassian (PL-403, §4.5.2). Fonctions sans état : `fetch` injecté, aucun accès base.
// 1. Redirection vers https://auth.atlassian.com/authorize (audience api.atlassian.com, `state` signé, prompt=consent).
// 2. Échange du code sur https://auth.atlassian.com/oauth/token, puis accessible-resources pour le cloudId.
// 3. Tous les appels passent par https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/… : aucune URL fournie par
//    le client n'est appelée (pas de surface SSRF).
// Les jetons ne sont jamais écrits dans un message d'erreur ni un journal.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const JIRA_SCOPES = [
  "read:jira-work",
  "read:jira-user",
  "manage:jira-webhook",
  "offline_access",
] as const;
/** Portées sans lesquelles un site n'est pas utilisable (offline_access n'apparaît pas dans accessible-resources). */
export const REQUIRED_SITE_SCOPES = ["read:jira-work", "read:jira-user", "manage:jira-webhook"];

const AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
const TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";
export const STATE_TTL_MS = 10 * 60_000;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// ─── state signé ───

export interface StateClaims {
  orgId: string;
  userId: string;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const stateKey = (secret: string) =>
  createHmac("sha256", secret).update("prooflayer:jira-oauth-state:v1").digest();

/** `state` signé (HMAC-SHA256), valable 10 minutes, qui porte l'organisation et l'utilisateur (§4.5.1, étape 1). */
export function signState(claims: StateClaims, secret: string, now: Date): string {
  const body = b64url(
    JSON.stringify({ ...claims, exp: now.getTime() + STATE_TTL_MS, n: b64url(randomBytes(12)) }),
  );
  const mac = b64url(createHmac("sha256", stateKey(secret)).update(body).digest());
  return `${body}.${mac}`;
}

const claimsSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().min(1),
  exp: z.number(),
});

/** Claims du `state`, ou null s'il est altéré, mal formé ou expiré. */
export function verifyState(state: string, secret: string, now: Date): StateClaims | null {
  const [body, mac, extra] = state.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = createHmac("sha256", stateKey(secret)).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = claimsSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (claims.exp < now.getTime()) return null;
    return { orgId: claims.orgId, userId: claims.userId };
  } catch {
    return null;
  }
}

export function authorizeUrl(client: Pick<OAuthClient, "clientId" | "redirectUri">, state: string) {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: client.clientId,
    scope: JIRA_SCOPES.join(" "),
    redirect_uri: client.redirectUri,
    state,
    response_type: "code",
    prompt: "consent",
  }).toString();
  return url.toString();
}

// ─── jetons ───

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Date d'expiration du jeton d'accès, ISO 8601. */
  expiresAt: string;
  scopes: string[];
}

export class JiraOAuthError extends Error {
  constructor(
    readonly kind: "invalid_grant" | "http" | "invalid_response",
    readonly status: number | null,
  ) {
    super(`Atlassian OAuth : ${kind}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "JiraOAuthError";
  }
}

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});

async function tokenRequest(fetchImpl: typeof fetch, body: Record<string, string>, now: Date) {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    // Jeton de rafraîchissement consommé, révoqué ou expiré : la connexion doit être refaite.
    if (error?.error === "invalid_grant" || response.status === 403) {
      throw new JiraOAuthError("invalid_grant", response.status);
    }
    throw new JiraOAuthError("http", response.status);
  }
  const parsed = tokenResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new JiraOAuthError("invalid_response", response.status);
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresAt: new Date(now.getTime() + parsed.data.expires_in * 1000).toISOString(),
    scopes: parsed.data.scope ? parsed.data.scope.split(" ").filter(Boolean) : [],
  } satisfies TokenSet;
}

export const exchangeCode = (
  fetchImpl: typeof fetch,
  client: OAuthClient,
  code: string,
  now: Date,
) =>
  tokenRequest(
    fetchImpl,
    {
      grant_type: "authorization_code",
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      redirect_uri: client.redirectUri,
    },
    now,
  );

/** Rafraîchissement : le jeton de rafraîchissement est rotatif, l'ancien devient invalide (§4.5.2). */
export const refreshTokens = (
  fetchImpl: typeof fetch,
  client: Pick<OAuthClient, "clientId" | "clientSecret">,
  refreshToken: string,
  now: Date,
) =>
  tokenRequest(
    fetchImpl,
    {
      grant_type: "refresh_token",
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
    },
    now,
  );

// ─── sites accessibles ───

const resourcesSchema = z.array(
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    url: z.string().url(),
    scopes: z.array(z.string()),
  }),
);
export type JiraSite = z.infer<typeof resourcesSchema>[number];

export async function accessibleResources(
  fetchImpl: typeof fetch,
  accessToken: string,
): Promise<JiraSite[]> {
  const response = await fetchImpl(RESOURCES_URL, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new JiraOAuthError("http", response.status);
  const parsed = resourcesSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new JiraOAuthError("invalid_response", response.status);
  return parsed.data;
}

/** Sites qui portent toutes les portées requises. */
export const usableSites = (sites: JiraSite[]) =>
  sites.filter((s) => REQUIRED_SITE_SCOPES.every((scope) => s.scopes.includes(scope)));

// ─── appels à l'API Jira ───

const API_PATH = /^\/[A-Za-z0-9/_\-.~]*(\?[A-Za-z0-9_\-.~=&%+,:()"' ]*)?$/u;

/** URL d'un appel à l'API Jira Cloud : hôte fixe, cloudId UUID, chemin relatif contrôlé. */
export function jiraApiUrl(cloudId: string, path: string): string {
  if (!z.string().uuid().safeParse(cloudId).success) throw new Error("cloudId invalide");
  if (!API_PATH.test(path) || path.includes("..") || path.includes("//")) {
    throw new Error("chemin d'API Jira invalide");
  }
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3${path}`;
}
