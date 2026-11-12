// Normaliseurs Jira (PL-404, §3.2 E4, §4.5.3) : fonctions pures, entrée validée par Zod, liste blanche de champs.
// - `jira.issue.snapshot` : état du ticket au moment de la capture (statut, priorité, étiquettes, assigné, résolution,
//   liens, historique des statuts), une preuve par jour et par état ; `inMapping: false` quand le ticket a quitté la
//   correspondance.
// - `jira.issue.transitioned` : chaque changement de statut, avec horodatage et auteur.
// Jamais la description, les commentaires, les pièces jointes ni le nom ou l'email d'une personne : seulement des
// identifiants de compte Atlassian (données personnelles effaçables, reprises dans `actor`).
import { z } from "zod";
import { contentSha256 } from "@/server/seal/evidence";
import { dayOf, parse, type NormalizerContext } from "../github/normalizers/common";
import type { EvidenceInput } from "@/server/services/evidence";

export const ISSUE_SNAPSHOT = "jira.issue.snapshot";
export const ISSUE_TRANSITIONED = "jira.issue.transitioned";

export const JIRA_PURPOSES = [
  "risks",
  "incidents",
  "monitoring_reviews",
  "release_validations",
] as const;
export type JiraPurpose = (typeof JIRA_PURPOSES)[number];

export type JiraEvidence = Omit<EvidenceInput, "raw">;

export interface JiraNormalizerContext extends Omit<NormalizerContext, "orgId"> {
  /** Correspondance (IntegrationResource `jira_query`) à laquelle la preuve est rattachée. */
  resourceId: string;
  purpose: JiraPurpose;
  /** Date de la capture : un instantané par jour et par état. */
  capturedAt: Date;
  /** Champ personnalisé (sélecteur d'utilisateur) qui porte l'acceptation du risque résiduel, s'il est configuré. */
  acceptanceField?: string | null;
  /** Adresse publique du site, pour le lien vers le ticket (jamais appelée par ProofLayer). */
  siteUrl?: string | null;
}

const named = z.object({ name: z.string() }).nullable().optional();
const account = z.object({ accountId: z.string() }).nullable().optional();
const linkedIssue = z.object({ key: z.string() }).optional();

export const issueSchema = z.object({
  id: z.string().min(1),
  key: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/u),
  fields: z
    .object({
      summary: z.string().optional().default(""),
      project: z.object({ key: z.string() }),
      issuetype: z.object({ name: z.string() }),
      status: z.object({
        name: z.string(),
        statusCategory: z.object({ key: z.string() }).optional(),
      }),
      priority: named,
      labels: z.array(z.string()).optional().default([]),
      assignee: account,
      resolution: named,
      resolutiondate: z.string().nullable().optional(),
      created: z.string(),
      updated: z.string(),
      issuelinks: z
        .array(
          z.object({
            type: z.object({ name: z.string() }),
            inwardIssue: linkedIssue,
            outwardIssue: linkedIssue,
          }),
        )
        .optional()
        .default([]),
    })
    .passthrough(),
  changelog: z
    .object({
      histories: z.array(
        z.object({
          id: z.string(),
          created: z.string(),
          author: account,
          items: z.array(
            z.object({
              field: z.string(),
              fromString: z.string().nullable().optional(),
              toString: z.string().nullable().optional(),
            }),
          ),
        }),
      ),
    })
    .optional(),
});
export type JiraIssue = z.infer<typeof issueSchema>;

const iso = (value: string) => new Date(value).toISOString();
const MAX_TITLE = 200;

/** Changements de statut, du plus ancien au plus récent. */
function statusHistory(issue: JiraIssue) {
  return (issue.changelog?.histories ?? [])
    .flatMap((h) =>
      h.items
        .filter((i) => i.field === "status")
        .map((i) => ({
          historyId: h.id,
          at: iso(h.created),
          from: i.fromString ?? null,
          to: i.toString ?? null,
          authorAccountId: h.author?.accountId ?? null,
        })),
    )
    .sort((a, b) => a.at.localeCompare(b.at) || a.historyId.localeCompare(b.historyId));
}

function acceptedBy(issue: JiraIssue, field: string | null | undefined) {
  if (!field) return undefined;
  const value = (issue.fields as Record<string, unknown>)[field];
  const parsed = account.safeParse(value);
  return parsed.success ? (parsed.data?.accountId ?? null) : null;
}

/** Instantané et transitions d'un ticket qui appartient à la correspondance. */
export function normalizeIssue(payload: unknown, ctx: JiraNormalizerContext): JiraEvidence[] {
  const issue = parse(issueSchema, payload, ISSUE_SNAPSHOT, { ...ctx, orgId: "" });
  if (!issue) return [];
  const f = issue.fields;
  const history = statusHistory(issue);
  const sourceUrl = ctx.siteUrl ? `${ctx.siteUrl.replace(/\/$/u, "")}/browse/${issue.key}` : null;
  const accepted = acceptedBy(issue, ctx.acceptanceField);
  const state = {
    issueId: issue.id,
    key: issue.key,
    project: f.project.key,
    purpose: ctx.purpose,
    inMapping: true,
    title: f.summary.slice(0, MAX_TITLE),
    issueType: f.issuetype.name,
    status: f.status.name,
    statusCategory: f.status.statusCategory?.key ?? null,
    priority: f.priority?.name ?? null,
    labels: [...f.labels].sort(),
    assigneeAccountId: f.assignee?.accountId ?? null,
    resolution: f.resolution?.name ?? null,
    resolutionDate: f.resolutiondate ? iso(f.resolutiondate) : null,
    created: iso(f.created),
    updated: iso(f.updated),
    links: f.issuelinks
      .flatMap((l) => [
        ...(l.outwardIssue
          ? [{ type: l.type.name, direction: "outward", key: l.outwardIssue.key }]
          : []),
        ...(l.inwardIssue
          ? [{ type: l.type.name, direction: "inward", key: l.inwardIssue.key }]
          : []),
      ])
      .sort((a, b) => a.key.localeCompare(b.key) || a.type.localeCompare(b.type)),
    statusHistory: history.map(({ at, from, to }) => ({ at, from, to })),
    ...(accepted !== undefined ? { acceptedByAccountId: accepted } : {}),
  };
  const fingerprint = contentSha256(state).toString("hex").slice(0, 16);
  const capturedAt = ctx.capturedAt.toISOString();
  const snapshot: JiraEvidence = {
    kind: ISSUE_SNAPSHOT,
    source: "JIRA",
    capturedVia: ctx.capturedVia,
    resourceId: ctx.resourceId,
    sourceRef: `jira:${issue.id}`,
    sourceUrl,
    dedupeKey: `jira:snap:${ctx.resourceId}:${issue.id}:${dayOf(capturedAt)}:${fingerprint}`,
    occurredAt: ctx.capturedAt,
    summary: `${issue.key} · ${f.status.name}`,
    actor: state.assigneeAccountId ? { login: state.assigneeAccountId } : null,
    payload: { ...state, capturedAt },
  };
  const transitions: JiraEvidence[] = history.map((t) => ({
    kind: ISSUE_TRANSITIONED,
    source: "JIRA",
    capturedVia: ctx.capturedVia,
    resourceId: ctx.resourceId,
    sourceRef: `jira:${issue.id}:history:${t.historyId}`,
    sourceUrl,
    dedupeKey: `jira:tr:${ctx.resourceId}:${issue.id}:${t.historyId}`,
    occurredAt: new Date(t.at),
    summary: `${issue.key} : ${t.from ?? "∅"} → ${t.to ?? "∅"}`,
    actor: t.authorAccountId ? { login: t.authorAccountId } : null,
    payload: {
      issueId: issue.id,
      key: issue.key,
      purpose: ctx.purpose,
      from: t.from,
      to: t.to,
      at: t.at,
      authorAccountId: t.authorAccountId,
    },
  }));
  return [snapshot, ...transitions];
}

/** Instantané d'un ticket sorti de la correspondance (supprimé, ou ne répondant plus à la requête). */
export function normalizeRemoval(
  issue: { issueId: string; key: string },
  ctx: Pick<JiraNormalizerContext, "resourceId" | "purpose" | "capturedAt" | "capturedVia">,
): JiraEvidence {
  const capturedAt = ctx.capturedAt.toISOString();
  const state = { issueId: issue.issueId, key: issue.key, purpose: ctx.purpose, inMapping: false };
  return {
    kind: ISSUE_SNAPSHOT,
    source: "JIRA",
    capturedVia: ctx.capturedVia,
    resourceId: ctx.resourceId,
    sourceRef: `jira:${issue.issueId}`,
    dedupeKey: `jira:snap:${ctx.resourceId}:${issue.issueId}:${dayOf(capturedAt)}:out`,
    occurredAt: ctx.capturedAt,
    summary: `${issue.key} : hors correspondance`,
    actor: null,
    payload: { ...state, capturedAt },
  };
}
