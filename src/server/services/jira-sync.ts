// Synchronisation Jira (PL-404, §3.2 E4, §4.5.2).
// - Correspondances : une `IntegrationResource` `jira_query` par système et par finalité (registre des risques,
//   incidents IA, revues de surveillance, validations de release), reliée au système par `SystemResourceLink`.
// - `syncIssue` relit un ticket avec son historique (`expand=changelog`) et teste son appartenance à chaque
//   correspondance par une recherche `key = X AND (<jql>)` ; instantané et transitions, ou sortie de correspondance.
// - `reconcile` interroge `(<jql>) AND updated >= "-20m"` (toutes les 15 minutes) ou la requête entière (rattrapage
//   et passage quotidien) et programme la relecture des tickets trouvés : les webhooks ne servent qu'à la latence.
// - `ensureWebhook` : un seul webhook par site, filtré par `project IN (…)`, prolongé avant son expiration à 30 jours.
// Les appels réseau précèdent toute écriture sur la ligne `Integration` (le rafraîchissement du jeton la verrouille).
import type { OrgTransaction } from "@/server/db";
import {
  ISSUE_SNAPSHOT,
  JIRA_PURPOSES,
  normalizeIssue,
  normalizeRemoval,
  type JiraPurpose,
} from "@/server/connectors/jira/normalizers";
import type { CaptureMethod } from "@/generated/prisma/enums";
import { createEvidence } from "./evidence";
import { scheduleEvaluations, type NewEvidence, type ScheduleEvaluation } from "./evaluation";
import { JiraApiError, jiraRequest, type JiraDependencies } from "./jira-integration";

export type JiraDeps = Pick<JiraDependencies, "fetch" | "master" | "now" | "client">;
export type ScheduleIssueSync = (
  tx: OrgTransaction,
  orgId: string,
  integrationId: string,
  issueKey: string,
) => Promise<unknown>;

export const MAPPING_KIND = "jira_query";
export const WEBHOOK_KIND = "jira_webhook";
export const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/u;

/** Requêtes proposées par défaut (§3.2 E4 pour les deux premières ; conventions ProofLayer pour les deux autres). */
export const DEFAULT_JQL: Record<JiraPurpose, string> = {
  risks: "labels = ai-risk",
  incidents: 'issuetype = "AI Incident"',
  monitoring_reviews: "labels = ai-monitoring-review",
  release_validations: "labels = ai-release-validation",
};

export interface MappingConfig {
  jql: string;
  purpose: JiraPurpose;
  systemId: string;
  acceptanceField?: string | null;
}

export interface Mapping {
  id: string;
  config: MappingConfig;
}

const ISSUE_FIELDS = [
  "summary",
  "project",
  "issuetype",
  "status",
  "priority",
  "labels",
  "assignee",
  "resolution",
  "resolutiondate",
  "created",
  "updated",
  "issuelinks",
];

const isPurpose = (p: unknown): p is JiraPurpose =>
  (JIRA_PURPOSES as readonly unknown[]).includes(p);

export async function listMappings(tx: OrgTransaction, integrationId: string): Promise<Mapping[]> {
  const rows = await tx.integrationResource.findMany({
    where: { integrationId, kind: MAPPING_KIND },
    select: { id: true, config: true },
    orderBy: { id: "asc" },
  });
  return rows.flatMap((r) => {
    const c = r.config as Partial<MappingConfig> | null;
    return c && typeof c.jql === "string" && isPurpose(c.purpose) && typeof c.systemId === "string"
      ? [{ id: r.id, config: c as MappingConfig }]
      : [];
  });
}

interface SearchPage {
  issues?: { id: string; key: string }[];
  nextPageToken?: string | null;
  isLast?: boolean;
}

/** Recherche JQL paginée (`/search/jql`), au plus `limit` tickets. */
export async function searchKeys(
  orgId: string,
  integrationId: string,
  jql: string,
  deps: JiraDeps,
  limit = 1000,
): Promise<{ id: string; key: string }[]> {
  const found: { id: string; key: string }[] = [];
  let nextPageToken: string | undefined;
  do {
    const page = await jiraRequest<SearchPage>(orgId, integrationId, "POST", "/search/jql", deps, {
      jql,
      fields: ["id"],
      maxResults: Math.min(100, limit - found.length),
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    found.push(...(page.issues ?? []));
    nextPageToken = page.isLast === true ? undefined : (page.nextPageToken ?? undefined);
  } while (nextPageToken && found.length < limit);
  return found;
}

/** Prévisualisation d'une correspondance : nombre approximatif de tickets (§3.2 E4). */
export async function countIssues(
  orgId: string,
  integrationId: string,
  jql: string,
  deps: JiraDeps,
) {
  const result = await jiraRequest<{ count?: number }>(
    orgId,
    integrationId,
    "POST",
    "/search/approximate-count",
    deps,
    { jql },
  );
  return result.count ?? 0;
}

/** Dernier instantané d'un ticket dans une correspondance : y est-il encore ? */
async function lastSnapshot(tx: OrgTransaction, resourceId: string, issueKey: string) {
  const row = await tx.evidenceItem.findFirst({
    where: { resourceId, kind: ISSUE_SNAPSHOT, payload: { path: ["key"], equals: issueKey } },
    orderBy: [{ occurredAt: "desc" }, { capturedAt: "desc" }],
    select: { payload: true },
  });
  return row?.payload as { issueId: string; key: string; inMapping: boolean } | undefined;
}

/**
 * Relit un ticket et l'inscrit dans chaque correspondance de l'intégration à laquelle il appartient ; un ticket qui
 * en sort (requête, suppression) reçoit un instantané « hors correspondance ». Les contrôles concernés sont programmés.
 */
export async function syncIssue(
  tx: OrgTransaction,
  input: {
    orgId: string;
    integrationId: string;
    issueKey: string;
    capturedVia: CaptureMethod;
    siteUrl?: string | null;
  },
  deps: JiraDeps,
  schedule: ScheduleEvaluation,
) {
  if (!ISSUE_KEY.test(input.issueKey)) throw new Error("clé de ticket invalide");
  const mappings = await listMappings(tx, input.integrationId);
  if (mappings.length === 0) return { created: 0 };
  const fields = [
    ...ISSUE_FIELDS,
    ...mappings.flatMap((m) => (m.config.acceptanceField ? [m.config.acceptanceField] : [])),
  ];

  // Réseau d'abord : le ticket, puis son appartenance à chaque correspondance.
  let issue: unknown = null;
  try {
    issue = await jiraRequest(
      input.orgId,
      input.integrationId,
      "GET",
      `/issue/${input.issueKey}?expand=changelog&fields=${fields.join(",")}`,
      deps,
    );
  } catch (error) {
    if (!(error instanceof JiraApiError && error.status === 404)) throw error;
  }
  const membership = new Map<string, boolean>();
  for (const m of mappings) {
    if (!issue) {
      membership.set(m.id, false);
      continue;
    }
    try {
      const hits = await searchKeys(
        input.orgId,
        input.integrationId,
        `key = ${input.issueKey} AND (${m.config.jql})`,
        deps,
        1,
      );
      membership.set(m.id, hits.length > 0);
    } catch (error) {
      // Requête refusée par Jira (JQL devenue invalide) : la correspondance est laissée de côté.
      if (error instanceof JiraApiError && error.status === 400) continue;
      throw error;
    }
  }

  const now = deps.now();
  const created: NewEvidence[] = [];
  for (const m of mappings) {
    const member = membership.get(m.id);
    if (member === undefined) continue;
    const items = member
      ? normalizeIssue(issue, {
          resourceId: m.id,
          purpose: m.config.purpose,
          capturedAt: now,
          capturedVia: input.capturedVia,
          acceptanceField: m.config.acceptanceField ?? null,
          siteUrl: input.siteUrl ?? null,
        })
      : await (async () => {
          const last = await lastSnapshot(tx, m.id, input.issueKey);
          return last?.inMapping
            ? [
                normalizeRemoval(last, {
                  resourceId: m.id,
                  purpose: m.config.purpose,
                  capturedAt: now,
                  capturedVia: input.capturedVia,
                }),
              ]
            : [];
        })();
    for (const item of items) {
      const result = await createEvidence(tx, input.orgId, item, { now: deps.now });
      if (result.created) created.push({ id: result.id, kind: item.kind, resourceId: m.id });
    }
  }
  await scheduleEvaluations(tx, input.orgId, created, schedule);
  return { created: created.length };
}

/**
 * Réconciliation : programme la relecture des tickets de chaque correspondance, modifiés depuis 20 minutes
 * (`incremental`) ou tous (`full`, avec les tickets précédemment inscrits qui n'apparaissent plus).
 */
export async function reconcile(
  tx: OrgTransaction,
  input: { orgId: string; integrationId: string; mode: "incremental" | "full" },
  deps: JiraDeps,
  schedule: ScheduleIssueSync,
) {
  const mappings = await listMappings(tx, input.integrationId);
  const keys = new Set<string>();
  for (const m of mappings) {
    const jql =
      input.mode === "incremental" ? `(${m.config.jql}) AND updated >= "-20m"` : m.config.jql;
    try {
      for (const hit of await searchKeys(input.orgId, input.integrationId, jql, deps)) {
        keys.add(hit.key);
      }
    } catch (error) {
      if (error instanceof JiraApiError && error.status === 400) continue;
      throw error;
    }
    if (input.mode === "full") {
      const present = await tx.$queryRaw<{ key: string; inMapping: string | null }[]>`
        SELECT DISTINCT ON (payload->>'key') payload->>'key' AS key, payload->>'inMapping' AS "inMapping"
        FROM "EvidenceItem"
        WHERE "resourceId" = ${m.id} AND kind = ${ISSUE_SNAPSHOT}
        ORDER BY payload->>'key', "occurredAt" DESC`;
      for (const row of present) if (row.inMapping === "true") keys.add(row.key);
    }
  }
  for (const key of keys)
    if (ISSUE_KEY.test(key)) await schedule(tx, input.orgId, input.integrationId, key);
  await tx.integration.update({
    where: { id: input.integrationId },
    data: { lastSyncAt: deps.now() },
  });
  return { scheduled: keys.size };
}

export const WEBHOOK_EVENTS = [
  "jira:issue_created",
  "jira:issue_updated",
  "jira:issue_deleted",
  "issuelink_created",
  "issuelink_deleted",
];
/** Durée de vie d'un webhook enregistré par API (§4.5.2) ; prolongé quand il reste moins de 7 jours. */
const WEBHOOK_TTL_MS = 30 * 86_400_000;
const WEBHOOK_REFRESH_BEFORE_MS = 7 * 86_400_000;

/** Projets utiles : ceux des tickets inscrits dans les correspondances de l'intégration. */
async function usefulProjects(tx: OrgTransaction, mappingIds: string[]) {
  if (mappingIds.length === 0) return [];
  const rows = await tx.$queryRaw<{ project: string }[]>`
    SELECT DISTINCT payload->>'project' AS project FROM "EvidenceItem"
    WHERE "resourceId" = ANY(${mappingIds}) AND kind = ${ISSUE_SNAPSHOT} AND payload->>'project' IS NOT NULL`;
  return rows
    .map((r) => r.project)
    .filter((p) => /^[A-Z][A-Z0-9_]*$/u.test(p))
    .sort();
}

/** Un seul webhook par site, filtré par `project IN (…)`, enregistré, prolongé ou réenregistré si les projets changent. */
export async function ensureWebhook(
  tx: OrgTransaction,
  input: { orgId: string; integrationId: string; url: string },
  deps: JiraDeps,
) {
  const mappings = await listMappings(tx, input.integrationId);
  const projects = await usefulProjects(
    tx,
    mappings.map((m) => m.id),
  );
  const existing = await tx.integrationResource.findFirst({
    where: { integrationId: input.integrationId, kind: WEBHOOK_KIND },
  });
  const config = existing?.config as { projects?: string[]; expiresAt?: string } | undefined;
  const now = deps.now();
  const sameProjects = JSON.stringify(config?.projects ?? []) === JSON.stringify(projects);

  if (existing && sameProjects && projects.length > 0) {
    const expiresAt = new Date(config?.expiresAt ?? 0).getTime();
    if (expiresAt - now.getTime() > WEBHOOK_REFRESH_BEFORE_MS) return { action: "none" as const };
    const refreshed = await jiraRequest<{ expirationDate?: string }>(
      input.orgId,
      input.integrationId,
      "PUT",
      "/webhook/refresh",
      deps,
      { webhookIds: [Number(existing.externalId)] },
    );
    await tx.integrationResource.update({
      where: { id: existing.id },
      data: {
        config: {
          projects,
          expiresAt:
            refreshed?.expirationDate ?? new Date(now.getTime() + WEBHOOK_TTL_MS).toISOString(),
        },
      },
    });
    return { action: "refreshed" as const };
  }
  if (existing) {
    await jiraRequest(input.orgId, input.integrationId, "DELETE", "/webhook", deps, {
      webhookIds: [Number(existing.externalId)],
    }).catch((error: unknown) => {
      if (!(error instanceof JiraApiError && error.status === 404)) throw error;
    });
    await tx.integrationResource.delete({ where: { id: existing.id } });
  }
  if (projects.length === 0) return { action: existing ? ("removed" as const) : ("none" as const) };
  const registered = await jiraRequest<{
    webhookRegistrationResult?: { createdWebhookId?: number; errors?: string[] }[];
  }>(input.orgId, input.integrationId, "POST", "/webhook", deps, {
    url: input.url,
    webhooks: [{ events: WEBHOOK_EVENTS, jqlFilter: `project IN (${projects.join(", ")})` }],
  });
  const id = registered?.webhookRegistrationResult?.[0]?.createdWebhookId;
  if (typeof id !== "number") throw new Error("Jira : enregistrement du webhook refusé");
  await tx.integrationResource.create({
    data: {
      orgId: input.orgId,
      integrationId: input.integrationId,
      kind: WEBHOOK_KIND,
      externalId: String(id),
      name: "webhook",
      config: { projects, expiresAt: new Date(now.getTime() + WEBHOOK_TTL_MS).toISOString() },
    },
  });
  return { action: "registered" as const, projects };
}
