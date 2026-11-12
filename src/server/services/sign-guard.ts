// Confirmation par mot de passe des signatures (classification, dossier d'exemption, attestation) : essais limités (§4.7).
import type { forOrg } from "@/server/db";
import { audit, clientIp } from "./audit";
import { ServiceError } from "./errors";
import type { OrgContext } from "./organization";

/** Après ce nombre de mots de passe refusés dans la fenêtre, la signature est bloquée pour l'utilisateur. */
export const SIGN_MAX_REFUSALS = 5;
export const SIGN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export interface SignDependencies {
  /** Vérifie le mot de passe de l'utilisateur courant (Better Auth, verifyPassword). */
  verifyPassword: (password: string) => Promise<boolean>;
}

const REFUSAL_ACTIONS = [
  "classification.signRefused",
  "exemption.signRefused",
  "evidence.attestRefused",
] as const;

/**
 * Confirmation par mot de passe à essais limités (§4.7), commune à toutes les signatures : une session volée ne
 * permet pas de deviner le mot de passe à force d'essais. Chaque refus est journalisé, sans le mot de passe.
 */
export async function assertSignAttemptsLeft(ctx: OrgContext) {
  const refusals = await orgDb(ctx).auditLog.count({
    where: {
      action: { in: [...REFUSAL_ACTIONS] },
      actorId: ctx.userId,
      createdAt: { gte: new Date(Date.now() - SIGN_ATTEMPT_WINDOW_MS) },
    },
  });
  if (refusals >= SIGN_MAX_REFUSALS) {
    throw new ServiceError("TOO_MANY_REQUESTS", "classification.tooManyAttempts");
  }
}

export function recordSignRefusal(
  ctx: OrgContext,
  input: {
    systemId: string;
    target: "classification" | "exemption" | "evidence";
    targetId: string;
  },
) {
  const action = {
    classification: "classification.signRefused",
    exemption: "exemption.signRefused",
    evidence: "evidence.attestRefused",
  } as const;
  const targetType = {
    classification: "classification",
    exemption: "exemption_dossier",
    evidence: "control_instance",
  } as const;
  return audit(
    {
      orgId: ctx.orgId,
      actor: { type: "user", id: ctx.userId },
      ipAddress: clientIp(ctx.headers),
      db: ctx.db,
    },
    action[input.target],
    { type: targetType[input.target], id: input.targetId },
    { systemId: input.systemId },
  );
}

function orgDb(ctx: OrgContext): ReturnType<typeof forOrg> {
  if (!ctx.db) throw new Error("forOrg(orgId) requis");
  return ctx.db;
}
