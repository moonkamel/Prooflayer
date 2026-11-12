// Connexion Jira Cloud (PL-403, §3.2 E4, §4.5.2) : OAuth 2.0 (3LO) en lecture seule plus gestion des webhooks.
// - `state` signé (10 minutes) qui porte l'organisation et l'utilisateur ; vérifié au retour contre la session.
// - Jetons d'accès et de rafraîchissement chiffrés en AES-256-GCM sous la clé de données de l'organisation
//   (`Integration.credentialsCiphertext`), jamais en clair en base ni dans un journal.
// - Rafraîchissement sous `SELECT … FOR UPDATE` de la ligne `Integration` : deux jobs concurrents ne consomment jamais
//   le même jeton de rafraîchissement rotatif, ce qui déconnecterait le client.
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { withOrgTransaction, type OrgTransaction } from "@/server/db";
import { decrypt, encrypt, masterKeyFromEnv, type MasterKey } from "@/server/crypto/envelope";
import {
  accessibleResources,
  authorizeUrl,
  exchangeCode,
  jiraApiUrl,
  JiraOAuthError,
  refreshTokens,
  signState,
  usableSites,
  verifyState,
  type OAuthClient,
  type TokenSet,
} from "@/server/connectors/jira/oauth";
import { audit, clientIp } from "./audit";
import { ServiceError } from "./errors";
import { orgDataKey } from "./evidence";
import type { OrgContext } from "./organization";

/** Marge avant expiration en deçà de laquelle le jeton d'accès est rafraîchi. */
export const REFRESH_MARGIN_MS = 60_000;

export interface JiraDependencies {
  fetch: typeof fetch;
  master: MasterKey;
  now: () => Date;
  client: OAuthClient;
  stateSecret: string;
}

type Env = Record<string, string | undefined>;

/** Dépendances lues dans l'environnement ; sans application OAuth déclarée, la connexion est indisponible. */
export function jiraDependencies(env: Env = process.env): JiraDependencies {
  if (!env.JIRA_CLIENT_ID || !env.JIRA_CLIENT_SECRET || !env.BETTER_AUTH_URL) {
    throw new ServiceError("PRECONDITION_FAILED", "integration.jira.notConfigured");
  }
  if (!env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET absent");
  return {
    fetch,
    master: masterKeyFromEnv(env),
    now: () => new Date(),
    stateSecret: env.BETTER_AUTH_SECRET,
    client: {
      clientId: env.JIRA_CLIENT_ID,
      clientSecret: env.JIRA_CLIENT_SECRET,
      redirectUri: new URL("/api/integrations/jira/callback", env.BETTER_AUTH_URL).toString(),
    },
  };
}

const credentialsAad = (orgId: string, cloudId: string) => `integration:${orgId}:JIRA:${cloudId}`;

const credentialsSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string(),
  scopes: z.array(z.string()),
});

async function sealCredentials(
  tx: OrgTransaction,
  orgId: string,
  cloudId: string,
  tokens: TokenSet,
  master: MasterKey,
) {
  const dek = await orgDataKey(tx, orgId, master);
  return new Uint8Array(
    encrypt(dek, Buffer.from(JSON.stringify(tokens), "utf8"), credentialsAad(orgId, cloudId)),
  );
}

async function openCredentials(
  tx: OrgTransaction,
  orgId: string,
  cloudId: string,
  sealed: Uint8Array,
  master: MasterKey,
): Promise<TokenSet> {
  const dek = await orgDataKey(tx, orgId, master);
  return credentialsSchema.parse(
    JSON.parse(decrypt(dek, sealed, credentialsAad(orgId, cloudId)).toString("utf8")),
  );
}

/** `integration.jira.authorizeUrl` (§4.4.2) : adresse de consentement Atlassian, `state` signé. */
export function jiraAuthorizeUrl(ctx: OrgContext, deps: JiraDependencies = jiraDependencies()) {
  const state = signState({ orgId: ctx.orgId, userId: ctx.userId }, deps.stateSecret, deps.now());
  return { url: authorizeUrl(deps.client, state) };
}

/**
 * Retour du consentement : `state` vérifié contre la session (même organisation, même utilisateur), code échangé,
 * site obtenu par accessible-resources, intégration créée ou reconnectée avec ses jetons chiffrés.
 * Un site déjà lié à une autre organisation est refusé (unicité `provider, externalAccountId`).
 */
export async function completeJiraAuthorization(
  ctx: OrgContext,
  input: { code: string; state: string },
  deps: JiraDependencies = jiraDependencies(),
) {
  const claims = verifyState(input.state, deps.stateSecret, deps.now());
  if (!claims || claims.orgId !== ctx.orgId || claims.userId !== ctx.userId) {
    throw new ServiceError("BAD_REQUEST", "integration.jira.invalidState");
  }
  let tokens: TokenSet;
  try {
    tokens = await exchangeCode(deps.fetch, deps.client, input.code, deps.now());
  } catch (error) {
    if (error instanceof JiraOAuthError) {
      throw new ServiceError("BAD_REQUEST", "integration.jira.exchangeFailed");
    }
    throw error;
  }
  const [site, ...others] = usableSites(await accessibleResources(deps.fetch, tokens.accessToken));
  if (!site) throw new ServiceError("BAD_REQUEST", "integration.jira.noUsableSite");

  let integration: { id: string; reconnected: boolean };
  try {
    integration = await withOrgTransaction(ctx.orgId, async (tx) => {
      const credentialsCiphertext = await sealCredentials(
        tx,
        ctx.orgId,
        site.id,
        tokens,
        deps.master,
      );
      const existing = await tx.integration.findFirst({
        where: { provider: "JIRA", externalAccountId: site.id },
        select: { id: true },
      });
      const data = {
        externalAccountName: site.name,
        status: "ACTIVE" as const,
        credentialsCiphertext,
        scopes: tokens.scopes,
        lastError: null,
      };
      if (existing) {
        await tx.integration.update({ where: { id: existing.id }, data });
        return { id: existing.id, reconnected: true };
      }
      const created = await tx.integration.create({
        data: {
          ...data,
          orgId: ctx.orgId,
          provider: "JIRA",
          externalAccountId: site.id,
          createdByUserId: ctx.userId,
        },
        select: { id: true },
      });
      return { id: created.id, reconnected: false };
    });
  } catch (error) {
    // Le site est déjà lié à une autre organisation (RLS : la ligne n'est pas visible d'ici).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ServiceError("CONFLICT", "integration.jira.siteLinkedElsewhere");
    }
    throw error;
  }

  await audit(
    {
      orgId: ctx.orgId,
      actor: { type: "user", id: ctx.userId },
      ipAddress: clientIp(ctx.headers),
      db: ctx.db,
    },
    "integration.connect",
    { type: "integration", id: integration.id },
    {
      provider: "JIRA",
      cloudId: site.id,
      siteName: site.name,
      scopes: tokens.scopes,
      reconnected: integration.reconnected,
      // Autres sites autorisés au consentement : non liés, à connecter séparément.
      ignoredSites: others.length,
    },
  );
  return { integrationId: integration.id, siteName: site.name };
}

/**
 * Jeton d'accès valide pour une intégration Jira. Rafraîchi si nécessaire, sous verrou de ligne : un second appel
 * concurrent attend le premier, puis relit le jeton déjà rafraîchi au lieu de consommer l'ancien jeton rotatif.
 * Jeton de rafraîchissement refusé par Atlassian (révocation) : intégration REVOKED.
 */
export async function jiraAccessToken(
  orgId: string,
  integrationId: string,
  deps: Pick<JiraDependencies, "fetch" | "master" | "now" | "client">,
): Promise<{ accessToken: string; cloudId: string }> {
  const outcome = await withOrgTransaction(orgId, async (tx) => {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Integration" WHERE id = ${integrationId} AND provider = 'JIRA' FOR UPDATE`;
    if (!locked) throw new ServiceError("NOT_FOUND", "integration.notFound");
    const row = await tx.integration.findUniqueOrThrow({ where: { id: integrationId } });
    if (row.status === "REVOKED" || !row.credentialsCiphertext) {
      throw new ServiceError("PRECONDITION_FAILED", "integration.jira.revoked");
    }
    const tokens = await openCredentials(
      tx,
      orgId,
      row.externalAccountId,
      row.credentialsCiphertext,
      deps.master,
    );
    const now = deps.now();
    if (new Date(tokens.expiresAt).getTime() - now.getTime() > REFRESH_MARGIN_MS) {
      return { ok: true as const, accessToken: tokens.accessToken, cloudId: row.externalAccountId };
    }
    try {
      const fresh = await refreshTokens(deps.fetch, deps.client, tokens.refreshToken, now);
      await tx.integration.update({
        where: { id: row.id },
        data: {
          credentialsCiphertext: await sealCredentials(
            tx,
            orgId,
            row.externalAccountId,
            { ...fresh, scopes: fresh.scopes.length ? fresh.scopes : tokens.scopes },
            deps.master,
          ),
          status: "ACTIVE",
          lastError: null,
        },
      });
      return { ok: true as const, accessToken: fresh.accessToken, cloudId: row.externalAccountId };
    } catch (error) {
      if (error instanceof JiraOAuthError && error.kind === "invalid_grant") {
        await tx.integration.update({
          where: { id: row.id },
          data: { status: "REVOKED", lastError: "Accès révoqué côté Atlassian (invalid_grant)" },
        });
        return { ok: false as const };
      }
      throw error;
    }
  });
  if (!outcome.ok) throw new ServiceError("PRECONDITION_FAILED", "integration.jira.revoked");
  return { accessToken: outcome.accessToken, cloudId: outcome.cloudId };
}

/** Réponse d'erreur de l'API Jira, sans corps (il peut contenir des données de tickets). */
export class JiraApiError extends Error {
  constructor(readonly status: number) {
    super(`Jira : HTTP ${status}`);
    this.name = "JiraApiError";
  }
}

/**
 * Appel à l'API Jira Cloud d'une intégration : hôte Atlassian fixe, chemin contrôlé. Lecture seule, sauf la gestion du
 * webhook de l'application (portée manage:jira-webhook). Ne pas appeler pendant qu'une transaction tient la ligne
 * `Integration` : le rafraîchissement du jeton la verrouille.
 */
export async function jiraRequest<T>(
  orgId: string,
  integrationId: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  deps: Pick<JiraDependencies, "fetch" | "master" | "now" | "client">,
  body?: unknown,
): Promise<T> {
  const { accessToken, cloudId } = await jiraAccessToken(orgId, integrationId, deps);
  const response = await deps.fetch(jiraApiUrl(cloudId, path), {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new JiraApiError(response.status);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Appel en lecture à l'API Jira Cloud d'une intégration. */
export const jiraGet = <T>(
  orgId: string,
  integrationId: string,
  path: string,
  deps: Pick<JiraDependencies, "fetch" | "master" | "now" | "client">,
) => jiraRequest<T>(orgId, integrationId, "GET", path, deps);
