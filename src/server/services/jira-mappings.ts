// Correspondances Jira d'un système (PL-404, §3.2 E4) : quatre requêtes JQL (registre des risques, incidents IA,
// revues de surveillance, validations de release), prévisualisées par le nombre de tickets avant enregistrement.
// Une correspondance enregistrée déclenche le rattrapage complet de ses tickets (job `jira.reconcile`, mode full).
import { JIRA_PURPOSES, type JiraPurpose } from "@/server/connectors/jira/normalizers";
import { audit, clientIp } from "./audit";
import { ServiceError } from "./errors";
import { JiraApiError, jiraDependencies, type JiraDependencies } from "./jira-integration";
import { countIssues, DEFAULT_JQL, MAPPING_KIND, type MappingConfig } from "./jira-sync";
import type { OrgContext } from "./organization";

export const MAX_JQL = 1000;
export type ScheduleFullReconcile = (orgId: string, integrationId: string) => Promise<unknown>;

const dbOf = (ctx: OrgContext) => {
  if (!ctx.db) throw new Error("forOrg(orgId) requis");
  return ctx.db;
};
const externalIdOf = (systemId: string, purpose: JiraPurpose) => `${systemId}:${purpose}`;

async function systemOf(ctx: OrgContext, systemId: string) {
  const system = await dbOf(ctx).aiSystem.findFirst({ where: { id: systemId, orgId: ctx.orgId } });
  if (!system) throw new ServiceError("NOT_FOUND", "system.notFound");
  return system;
}

/** Intégration Jira de l'organisation (un site par organisation au MVP). */
async function jiraIntegrationOf(ctx: OrgContext) {
  return dbOf(ctx).integration.findFirst({
    where: { orgId: ctx.orgId, provider: "JIRA" },
    orderBy: { createdAt: "asc" },
    select: { id: true, externalAccountName: true, status: true },
  });
}

/** `integration.jira.mappings` : les quatre correspondances du système, avec les requêtes par défaut. */
export async function jiraMappings(ctx: OrgContext, input: { systemId: string }) {
  const system = await systemOf(ctx, input.systemId);
  const integration = await jiraIntegrationOf(ctx);
  const saved = integration
    ? await dbOf(ctx).integrationResource.findMany({
        where: {
          integrationId: integration.id,
          kind: MAPPING_KIND,
          externalId: { in: JIRA_PURPOSES.map((p) => externalIdOf(system.id, p)) },
        },
        select: { id: true, config: true, systemLinks: { where: { systemId: system.id } } },
      })
    : [];
  return {
    integration: integration
      ? { id: integration.id, name: integration.externalAccountName, status: integration.status }
      : null,
    mappings: JIRA_PURPOSES.map((purpose) => {
      const row = saved.find(
        (r) => (r.config as unknown as Partial<MappingConfig>).purpose === purpose,
      );
      return {
        purpose,
        defaultJql: DEFAULT_JQL[purpose],
        jql:
          row && row.systemLinks.length > 0 ? (row.config as unknown as MappingConfig).jql : null,
        resourceId: row?.id ?? null,
      };
    }),
  };
}

const cleanJql = (jql: string) => {
  const value = jql.trim();
  if (!value || value.length > MAX_JQL)
    throw new ServiceError("BAD_REQUEST", "integration.jira.invalidJql");
  return value;
};

async function activeIntegration(ctx: OrgContext, integrationId?: string) {
  const integration = await jiraIntegrationOf(ctx);
  if (!integration || (integrationId && integration.id !== integrationId)) {
    throw new ServiceError("NOT_FOUND", "integration.notFound");
  }
  if (integration.status !== "ACTIVE") {
    throw new ServiceError("PRECONDITION_FAILED", "integration.jira.revoked");
  }
  return integration;
}

async function count(ctx: OrgContext, integrationId: string, jql: string, deps: JiraDependencies) {
  try {
    return await countIssues(ctx.orgId, integrationId, jql, deps);
  } catch (error) {
    if (error instanceof JiraApiError && error.status === 400) {
      throw new ServiceError("BAD_REQUEST", "integration.jira.invalidJql");
    }
    throw error;
  }
}

/** `integration.jira.previewQuery` : nombre de tickets que retourne la requête, avant enregistrement. */
export async function previewJiraQuery(
  ctx: OrgContext,
  input: { integrationId: string; jql: string },
  deps: JiraDependencies = jiraDependencies(),
) {
  const integration = await activeIntegration(ctx, input.integrationId);
  return { count: await count(ctx, integration.id, cleanJql(input.jql), deps) };
}

/** `integration.jira.saveMapping` : enregistre la correspondance, la relie au système, lance le rattrapage. */
export async function saveJiraMapping(
  ctx: OrgContext,
  input: { systemId: string; purpose: JiraPurpose; jql: string; acceptanceField?: string | null },
  schedule: ScheduleFullReconcile,
  deps: JiraDependencies = jiraDependencies(),
) {
  const system = await systemOf(ctx, input.systemId);
  if (system.archivedAt) throw new ServiceError("CONFLICT", "system.archived");
  const integration = await activeIntegration(ctx);
  const jql = cleanJql(input.jql);
  if (input.acceptanceField && !/^customfield_\d+$/u.test(input.acceptanceField)) {
    throw new ServiceError("BAD_REQUEST", "integration.jira.invalidField");
  }
  const tickets = await count(ctx, integration.id, jql, deps);
  const db = dbOf(ctx);
  // Champ d'acceptation non fourni : celui déjà enregistré est conservé (null l'efface).
  const previous = await db.integrationResource.findUnique({
    where: {
      integrationId_kind_externalId: {
        integrationId: integration.id,
        kind: MAPPING_KIND,
        externalId: externalIdOf(system.id, input.purpose),
      },
    },
    select: { config: true },
  });
  const config: MappingConfig = {
    jql,
    purpose: input.purpose,
    systemId: system.id,
    acceptanceField:
      input.acceptanceField === undefined
        ? ((previous?.config as unknown as Partial<MappingConfig> | null)?.acceptanceField ?? null)
        : input.acceptanceField,
  };
  const resource = await db.integrationResource.upsert({
    where: {
      integrationId_kind_externalId: {
        integrationId: integration.id,
        kind: MAPPING_KIND,
        externalId: externalIdOf(system.id, input.purpose),
      },
    },
    create: {
      orgId: ctx.orgId,
      integrationId: integration.id,
      kind: MAPPING_KIND,
      externalId: externalIdOf(system.id, input.purpose),
      name: `${system.name} · ${input.purpose}`,
      config: { ...config },
    },
    update: { config: { ...config } },
    select: { id: true },
  });
  await db.systemResourceLink.upsert({
    where: { systemId_resourceId: { systemId: system.id, resourceId: resource.id } },
    create: { systemId: system.id, resourceId: resource.id, orgId: ctx.orgId, pathGlobs: [] },
    update: {},
  });
  await audit(
    {
      orgId: ctx.orgId,
      actor: { type: "user", id: ctx.userId },
      ipAddress: clientIp(ctx.headers),
      db,
    },
    "integration.mapping",
    { type: "ai_system", id: system.id },
    { provider: "JIRA", purpose: input.purpose, jql, tickets, resourceId: resource.id },
  );
  await schedule(ctx.orgId, integration.id);
  return { resourceId: resource.id, count: tickets };
}
