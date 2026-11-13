// Journal d'audit applicatif (PL-106, §3.2 E10) : toute action d'écriture est inscrite (acteur, action, cible, date).
// Écrit par la connexion de l'organisation (forOrg) : RLS garantit qu'une entrée appartient à cette organisation.
// Métadonnées : jamais de secret, de jeton ni de charge brute (règle 8 de CLAUDE.md).
import { forOrg } from "@/server/db";
import { usersByIds } from "@/server/system/identity";
import { toCsv } from "./csv";

/** Actions journalisées. Une nouvelle action d'écriture s'ajoute ici et dans messages/{fr,en}.json (auditActions). */
export const AUDIT_ACTIONS = [
  "organization.create",
  "organization.update",
  "member.invite",
  "member.setRole",
  "member.remove",
  "invitation.revoke",
  "invitation.accept",
  "system.create",
  "system.update",
  "system.archive",
  "designChange.create",
  "designChange.qualify",
  "classification.draft",
  "classification.saveAnswers",
  "classification.compute",
  "classification.sign",
  "classification.signRefused",
  "control.instantiate",
  "control.assign",
  "control.setNotApplicable",
  "control.comment",
  "notification.preferences",
  "exemption.save",
  "exemption.sign",
  "exemption.signRefused",
  "integration.connect",
  "integration.mapping",
  "evidence.upload",
  "evidence.attest",
  "evidence.attestRefused",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type ActorType = "user" | "system" | "api_key";

export interface AuditContext {
  orgId: string;
  actor: { type: ActorType; id: string | null };
  ipAddress?: string | null;
  /** Connexion de l'organisation ; créée à partir de orgId si absente. */
  db?: ReturnType<typeof forOrg>;
}

export interface AuditTarget {
  type: string;
  id: string;
}

export async function audit(
  ctx: AuditContext,
  action: AuditAction,
  target: AuditTarget,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const db = ctx.db ?? forOrg(ctx.orgId);
  await db.auditLog.create({
    data: {
      orgId: ctx.orgId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      action,
      targetType: target.type,
      targetId: target.id,
      metadata: metadata as object,
      ipAddress: ctx.ipAddress ?? null,
    },
  });
}

/** Adresse du client : premier élément de X-Forwarded-For (posé par l'hébergeur), sinon inconnue. */
export function clientIp(headers: Headers): string | null {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first ? first.slice(0, 64) : null;
}

export interface AuditFilters {
  action?: AuditAction;
  from?: Date;
  to?: Date;
}

export interface AuditEntry {
  id: string;
  createdAt: string;
  action: string;
  actorType: string;
  actorId: string | null;
  targetType: string;
  targetId: string;
  metadata: unknown;
  ipAddress: string | null;
}

function whereOf(filters: AuditFilters) {
  return {
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lt: filters.to } : {}),
          },
        }
      : {}),
  };
}

const toEntry = (row: {
  id: string;
  createdAt: Date;
  action: string;
  actorType: string;
  actorId: string | null;
  targetType: string;
  targetId: string;
  metadata: unknown;
  ipAddress: string | null;
}): AuditEntry => ({ ...row, createdAt: row.createdAt.toISOString() });

/** Page du journal, de la plus récente à la plus ancienne ; `cursor` : identifiant de la dernière entrée lue. */
export async function listAudit(
  db: ReturnType<typeof forOrg>,
  filters: AuditFilters,
  page: { limit: number; cursor?: string },
) {
  const rows = await db.auditLog.findMany({
    where: whereOf(filters),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  });
  const entries = rows.slice(0, page.limit).map(toEntry);
  return { entries, nextCursor: rows.length > page.limit ? (entries.at(-1)?.id ?? null) : null };
}

/** Plafond de l'export : au-delà, l'utilisateur affine les filtres (période). */
export const AUDIT_EXPORT_LIMIT = 50_000;

export async function exportAuditCsv(
  db: ReturnType<typeof forOrg>,
  filters: AuditFilters,
  actorLabel: (actorId: string | null) => string,
): Promise<{ filename: string; csv: string; truncated: boolean }> {
  const rows = await db.auditLog.findMany({
    where: whereOf(filters),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: AUDIT_EXPORT_LIMIT + 1,
  });
  const truncated = rows.length > AUDIT_EXPORT_LIMIT;
  const csv = toCsv(
    [
      "date_utc",
      "actor_type",
      "actor",
      "action",
      "target_type",
      "target_id",
      "metadata",
      "ip_address",
    ],
    rows
      .slice(0, AUDIT_EXPORT_LIMIT)
      .map((r) => [
        r.createdAt.toISOString(),
        r.actorType,
        actorLabel(r.actorId),
        r.action,
        r.targetType,
        r.targetId,
        JSON.stringify(r.metadata),
        r.ipAddress ?? "",
      ]),
  );
  return { filename: `journal-audit-${new Date().toISOString().slice(0, 10)}.csv`, csv, truncated };
}

/** Filtres reçus de l'interface : dates AAAA-MM-JJ en UTC, `to` inclus (borne haute : le lendemain à minuit). */
export function parseAuditFilters(input: {
  action?: AuditAction;
  from?: string;
  to?: string;
}): AuditFilters {
  const day = 24 * 60 * 60 * 1000;
  return {
    action: input.action,
    from: input.from ? new Date(`${input.from}T00:00:00.000Z`) : undefined,
    to: input.to ? new Date(new Date(`${input.to}T00:00:00.000Z`).getTime() + day) : undefined,
  };
}

/** Page du journal avec le nom et l'adresse de chaque acteur. */
export async function listAuditWithActors(
  db: ReturnType<typeof forOrg>,
  filters: AuditFilters,
  page: { limit: number; cursor?: string },
) {
  const result = await listAudit(db, filters, page);
  const actors = await usersByIds(result.entries.flatMap((e) => (e.actorId ? [e.actorId] : [])));
  return {
    ...result,
    entries: result.entries.map((e) => ({
      ...e,
      actor: e.actorId ? (actors.get(e.actorId) ?? null) : null,
    })),
  };
}

/** Export CSV, l'acteur étant présenté par « nom <adresse> ». */
export async function exportAuditWithActors(db: ReturnType<typeof forOrg>, filters: AuditFilters) {
  const rows = await db.auditLog.findMany({ select: { actorId: true }, distinct: ["actorId"] });
  const actors = await usersByIds(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])));
  return exportAuditCsv(db, filters, (id) => {
    const actor = id ? actors.get(id) : undefined;
    return actor ? `${actor.name} <${actor.email}>` : (id ?? "");
  });
}
