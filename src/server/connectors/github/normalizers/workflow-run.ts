// Normaliseur `github.workflow_run.completed` : webhook `workflow_run` (action « completed »). Sert à AIA-09-04,
// AIA-15-03, AIA-15-04. Liste blanche : ni message de commit ni auteur de commit (adresses email).
import { z } from "zod";
import {
  loginOf,
  parse,
  repositorySchema,
  type GitHubEvidence,
  type NormalizerContext,
} from "./common";

export const WORKFLOW_RUN_COMPLETED = "github.workflow_run.completed";

const schema = z.object({
  action: z.literal("completed"),
  workflow_run: z.object({
    id: z.number().int().positive(),
    name: z.string().nullable(),
    path: z.string(),
    event: z.string(),
    head_branch: z.string().nullable(),
    head_sha: z.string(),
    status: z.string(),
    conclusion: z.string().nullable(),
    run_attempt: z.number().int().positive(),
    run_started_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    html_url: z.string().url(),
    triggering_actor: z.object({ login: z.string() }).nullable().optional(),
  }),
  repository: repositorySchema,
});

export function normalizeWorkflowRunCompleted(
  payload: unknown,
  ctx: NormalizerContext,
): GitHubEvidence[] {
  const event = parse(schema, payload, WORKFLOW_RUN_COMPLETED, ctx);
  if (!event) return [];
  const { workflow_run: run, repository } = event;
  const actor = loginOf(run.triggering_actor);
  return [
    {
      kind: WORKFLOW_RUN_COMPLETED,
      source: "GITHUB",
      capturedVia: ctx.capturedVia,
      resourceId: ctx.resourceId,
      sourceRef: `${repository.id}/run/${run.id}/${run.run_attempt}`,
      sourceUrl: run.html_url,
      dedupeKey: `gh:run:${repository.id}:${run.id}:${run.run_attempt}`,
      occurredAt: new Date(run.updated_at),
      summary: `Workflow ${run.name ?? run.path} : ${run.conclusion ?? run.status}`,
      actor: actor ? { login: actor } : null,
      payload: {
        runId: run.id,
        runAttempt: run.run_attempt,
        workflowName: run.name,
        workflowPath: run.path,
        event: run.event,
        headBranch: run.head_branch,
        headSha: run.head_sha,
        status: run.status,
        conclusion: run.conclusion,
        startedAt: new Date(run.run_started_at).toISOString(),
        completedAt: new Date(run.updated_at).toISOString(),
        defaultBranch: run.head_branch === repository.default_branch,
      },
    },
  ];
}
