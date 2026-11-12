// File de jobs dans Postgres (PL-107, §4.2, §4.3.3, §4.8). Table système « Job », sans RLS.
//
// Garanties :
// - Prise de lot sans contention : FOR UPDATE SKIP LOCKED (§4.3.3). Deux workers ne prennent jamais le même job.
// - Bail : un job pris porte lockedAt, son jeton. Un job RUNNING dont le bail a expiré (worker arrêté brutalement)
//   est repris par le drainage suivant.
// - Une seule fois avec effet : l'effet en base du gestionnaire et le passage à DONE sont validés dans la même
//   transaction, à condition que le jeton n'ait pas changé. Un worker interrompu ne valide rien ; un worker dont
//   le bail a été repris ne peut plus valider. Les effets hors base doivent être idempotents (registry.ts).
// - Réessais exponentiels avec aléa, 8 tentatives au plus, puis FAILED (§4.5.3).
import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { MAX_ATTEMPTS, retryDelayMs } from "./backoff";
import type { JobDefinition, JobRegistry } from "./registry";

/** Durée du bail : au-delà, un job RUNNING est considéré abandonné et repris. Supérieure à toute tentative. */
export const LEASE_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface EnqueueOptions {
  runAt?: Date;
  /** Clé d'unicité : un second enqueue avec la même clé est ignoré (§4.5.1, « Idempotence à trois niveaux »). */
  dedupeKey?: string;
  orgId?: string | null;
  maxAttempts?: number;
  /** Exécution immédiate après la réponse HTTP, par waitUntil ; le cron reste le filet de sécurité. */
  runNow?: { registry: JobRegistry };
}

export type EnqueueResult = { id: string; deduplicated: false } | { id: null; deduplicated: true };

export async function enqueue<P>(
  job: JobDefinition<P>,
  payload: P,
  options: EnqueueOptions = {},
): Promise<EnqueueResult> {
  const data = job.schema.parse(payload);
  let id: string;
  try {
    ({ id } = await prisma.job.create({
      data: {
        type: job.type,
        payload: data as Prisma.InputJsonValue,
        orgId: options.orgId ?? null,
        runAt: options.runAt ?? new Date(),
        dedupeKey: options.dedupeKey ?? null,
        maxAttempts: Math.min(options.maxAttempts ?? job.maxAttempts ?? MAX_ATTEMPTS, MAX_ATTEMPTS),
      },
      select: { id: true },
    }));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { id: null, deduplicated: true };
    }
    throw error;
  }
  if (options.runNow && (options.runAt ?? new Date()) <= new Date()) {
    waitUntil(runJobNow(id, options.runNow.registry).catch(() => undefined));
  }
  return { id, deduplicated: false };
}

export interface ClaimedJob {
  id: string;
  type: string;
  orgId: string | null;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  lockedAt: Date;
}

/** Prend jusqu'à `limit` jobs dus, ou dont le bail a expiré. Incrémente attempts et pose un nouveau jeton. */
export async function claimJobs(limit: number, onlyId?: string): Promise<ClaimedJob[]> {
  const leaseSeconds = LEASE_MS / 1000;
  return prisma.$queryRaw<ClaimedJob[]>`
    UPDATE "Job" SET status = 'RUNNING', "lockedAt" = clock_timestamp(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "Job"
      WHERE ((status = 'QUEUED' AND "runAt" <= now())
          OR (status = 'RUNNING' AND "lockedAt" < now() - make_interval(secs => ${leaseSeconds})))
        AND (${onlyId ?? null}::text IS NULL OR id = ${onlyId ?? null})
      ORDER BY "runAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type, "orgId", payload, attempts, "maxAttempts", "lockedAt"`;
}

export type Outcome = "done" | "retry" | "failed" | "lease_lost";

class LeaseLost extends Error {}

/** Message d'erreur conservé : jamais la charge, tronqué (règle 8 de CLAUDE.md). */
const describe = (error: unknown) =>
  (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500);

async function settleFailure(
  job: ClaimedJob,
  error: unknown,
  permanent: boolean,
): Promise<Outcome> {
  const finalAttempt = permanent || job.attempts >= job.maxAttempts;
  const updated = finalAttempt
    ? await prisma.$executeRaw`
        UPDATE "Job" SET status = 'FAILED', "lockedAt" = NULL, "finishedAt" = now(), "lastError" = ${describe(error)}
        WHERE id = ${job.id} AND status = 'RUNNING' AND "lockedAt" = ${job.lockedAt}`
    : await prisma.$executeRaw`
        UPDATE "Job" SET status = 'QUEUED', "lockedAt" = NULL, "lastError" = ${describe(error)},
          "runAt" = now() + make_interval(secs => ${retryDelayMs(job.attempts) / 1000})
        WHERE id = ${job.id} AND status = 'RUNNING' AND "lockedAt" = ${job.lockedAt}`;
  if (updated !== 1) return "lease_lost";
  return finalAttempt ? "failed" : "retry";
}

/** Exécute un job déjà pris. L'effet et la fin du job sont validés ensemble, sous réserve du jeton. */
export async function executeJob(job: ClaimedJob, registry: JobRegistry): Promise<Outcome> {
  const definition = registry.get(job.type);
  if (!definition) return settleFailure(job, new Error(`Type de job inconnu : ${job.type}`), true);
  if (job.attempts > job.maxAttempts)
    return settleFailure(job, new Error("Tentatives épuisées"), true);

  const parsed = definition.schema.safeParse(job.payload);
  if (!parsed.success) return settleFailure(job, new Error("Charge invalide pour son type"), true);

  try {
    await prisma.$transaction(
      async (tx) => {
        if (job.orgId) await tx.$executeRaw`SELECT set_config('app.org_id', ${job.orgId}, TRUE)`;
        await definition.handle(parsed.data, {
          tx,
          job: { id: job.id, type: job.type, orgId: job.orgId, attempts: job.attempts },
        });
        const completed = await tx.$executeRaw`
          UPDATE "Job" SET status = 'DONE', "lockedAt" = NULL, "finishedAt" = now(), "lastError" = NULL
          WHERE id = ${job.id} AND status = 'RUNNING' AND "lockedAt" = ${job.lockedAt}`;
        // Bail repris par un autre worker : annuler l'effet, l'autre tentative fait foi.
        if (completed !== 1) throw new LeaseLost();
      },
      { timeout: definition.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxWait: 10_000 },
    );
    return "done";
  } catch (error) {
    if (error instanceof LeaseLost) return "lease_lost";
    return settleFailure(job, error, false);
  }
}

/** Exécution immédiate d'un job précis (enqueue avec runNow). Sans effet s'il a déjà été pris. */
export async function runJobNow(id: string, registry: JobRegistry): Promise<Outcome | null> {
  const [job] = await claimJobs(1, id);
  return job ? executeJob(job, registry) : null;
}

export interface DrainStats {
  claimed: number;
  done: number;
  retry: number;
  failed: number;
  lease_lost: number;
}

/** Draine la file par lots de 20 (§4.3.3) jusqu'à épuisement ou fin du budget de temps. */
export async function drainJobs(
  registry: JobRegistry,
  options: { budgetMs?: number; batchSize?: number } = {},
): Promise<DrainStats> {
  const deadline = Date.now() + (options.budgetMs ?? 50_000);
  const stats: DrainStats = { claimed: 0, done: 0, retry: 0, failed: 0, lease_lost: 0 };
  while (Date.now() < deadline) {
    const batch = await claimJobs(options.batchSize ?? 20);
    if (batch.length === 0) break;
    stats.claimed += batch.length;
    for (const job of batch) stats[await executeJob(job, registry)] += 1;
  }
  return stats;
}

/**
 * Programme un job dans une transaction en cours (§4.5.1 : « INSERT EvidenceItem, liens, Job control.evaluate »),
 * dédupliqué par `dedupeKey` tant qu'il attend : un job déjà QUEUED n'est pas dupliqué. Un job terminé, en échec ou
 * en cours avec la même clé est réarmé ; une tentative en cours perd alors son jeton et s'annule, et la suivante
 * relit l'état à jour (aucune preuve arrivée pendant l'exécution n'est perdue).
 * Retourne l'identifiant du job créé ou réarmé, null s'il attendait déjà.
 */
export async function enqueueInTransaction<P>(
  tx: Prisma.TransactionClient,
  job: JobDefinition<P>,
  payload: P,
  options: { dedupeKey: string; orgId?: string | null; runAt?: Date },
): Promise<string | null> {
  const data = JSON.stringify(job.schema.parse(payload));
  const runAt = options.runAt ?? new Date();
  const maxAttempts = Math.min(job.maxAttempts ?? MAX_ATTEMPTS, MAX_ATTEMPTS);
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "Job" (id, type, "orgId", payload, "dedupeKey", "runAt", "maxAttempts")
    VALUES (${`job_${randomUUID().replaceAll("-", "")}`}, ${job.type}, ${options.orgId ?? null},
      ${data}::jsonb, ${options.dedupeKey}, ${runAt}, ${maxAttempts})
    ON CONFLICT ("dedupeKey") DO UPDATE SET
      status = 'QUEUED', payload = EXCLUDED.payload, "runAt" = EXCLUDED."runAt", attempts = 0,
      "maxAttempts" = EXCLUDED."maxAttempts", "lockedAt" = NULL, "finishedAt" = NULL, "lastError" = NULL
    WHERE "Job".status <> 'QUEUED'
    RETURNING id`;
  return rows[0]?.id ?? null;
}
