// Droits du plan (PL-602, §3.2 E11, §6.1) : lecture seule après l'essai ou un impayé, limite de systèmes surveillés
// et de dépôts liés. La limite est appliquée côté serveur ; au dépassement, l'ajout est refusé avec proposition de
// changement de plan, et rien n'est supprimé.
import { forOrg } from "@/server/db";
import {
  accessOf,
  canLinkRepository,
  canMonitorAnother,
  PLAN_LIMITS,
  type Access,
  type Plan,
} from "./billing-data";
import { ServiceError } from "./errors";

/** Ce qu'il faut lire (client `forOrg` ou transaction de l'organisation). */
interface Db {
  subscription: {
    findUnique(args: { where: { orgId: string } }): PromiseLike<{
      plan: Plan;
      status: string;
      trialEndsAt: Date | null;
      currentPeriodEnd: Date | null;
      monitoredSystemsLimit: number;
    } | null>;
  };
  aiSystem: { count(args: { where: Record<string, unknown> }): PromiseLike<number> };
  integrationResource: { count(args: { where: Record<string, unknown> }): PromiseLike<number> };
}

/** Accès de l'organisation ; sans abonnement enregistré (organisation créée hors parcours), aucun blocage. */
export async function accessFor(
  db: Pick<Db, "subscription">,
  orgId: string,
  now = new Date(),
): Promise<Access> {
  const sub = await db.subscription.findUnique({ where: { orgId } });
  if (!sub) return { kind: "trial", endsAt: null, daysLeft: 0 };
  return accessOf(sub, now);
}

export async function isReadOnly(orgId: string, now = new Date()) {
  return (await accessFor(forOrg(orgId), orgId, now)).kind === "readOnly";
}

export async function assertWritable(db: Pick<Db, "subscription">, orgId: string) {
  if ((await accessFor(db, orgId)).kind === "readOnly") {
    throw new ServiceError("FORBIDDEN", "billing.readOnly");
  }
}

export async function monitoringCapacity(db: Db, orgId: string) {
  const [sub, monitored] = await Promise.all([
    db.subscription.findUnique({ where: { orgId } }),
    db.aiSystem.count({ where: { orgId, monitored: true, archivedAt: null } }),
  ]);
  const plan: Plan = sub?.plan ?? "TRIAL";
  const limit = sub?.monitoredSystemsLimit ?? PLAN_LIMITS.TRIAL.monitoredSystems;
  return { plan, monitored, limit, available: canMonitorAnother(monitored, limit) };
}

/** Refus avec proposition de plan si la limite de systèmes surveillés est atteinte. */
export async function assertCanMonitor(db: Db, orgId: string) {
  const capacity = await monitoringCapacity(db, orgId);
  if (!capacity.available) throw new ServiceError("CONFLICT", "billing.monitoredLimit");
  return capacity;
}

/** À appeler par la sélection des dépôts GitHub (PL-303) avant de lier un dépôt. */
export async function assertCanLinkRepository(db: Db, orgId: string) {
  const [sub, linked] = await Promise.all([
    db.subscription.findUnique({ where: { orgId } }),
    db.integrationResource.count({ where: { orgId, kind: "github_repo" } }),
  ]);
  const limit = PLAN_LIMITS[sub?.plan ?? "TRIAL"].repositories;
  if (!canLinkRepository(linked, limit))
    throw new ServiceError("CONFLICT", "billing.repositoryLimit");
}
