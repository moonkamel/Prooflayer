// Jobs de suppression d'une organisation (PL-607), sans orgId (la purge supprime aussi les jobs de l'organisation) :
// `org.deletionNotice` prévient les owners qu'une purge est programmée ; `org.purge`, à l'échéance, efface le stockage
// objet de l'organisation, appelle `purge_organization` (clé de chiffrement comprise) et envoie la confirmation.
import { z } from "zod";
import { createEmailTransport, type EmailTransport } from "@/server/email/transport";
import {
  renderDeletionScheduledEmail,
  renderOrgDeletedEmail,
  type DeletionRecipient,
} from "@/server/email/org-deletion-emails";
import { createObjectStore, type ObjectStore } from "@/server/storage/object-store";
import { Prisma } from "@/generated/prisma/client";
import { membersOf, organizationById, userContact } from "../identity";
import { deletionById, purgeOrganizationRows } from "../org-deletion";
import { enqueue } from "./queue";
import { defineJob } from "./registry";

export interface OrgDeletionDependencies {
  store: ObjectStore;
  transport: EmailTransport;
  baseUrl: string;
  now: () => Date;
}

/** Dépendances remplaçables par les tests. */
export const orgDeletionDependencies: { get: () => OrgDeletionDependencies } = {
  get: () => ({
    store: createObjectStore(),
    transport: createEmailTransport(),
    baseUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    now: () => new Date(),
  }),
};

async function owners(orgId: string): Promise<DeletionRecipient[]> {
  const members = (await membersOf(orgId)).filter((m) => m.role === "owner");
  const contacts = await Promise.all(members.map((m) => userContact(m.userId)));
  return contacts.flatMap((c) => (c ? [{ email: c.email, name: c.name, locale: c.locale }] : []));
}

export const orgDeletionNoticeJob = defineJob({
  type: "org.deletionNotice",
  schema: z.object({ deletionId: z.string().min(1).max(128) }),
  handle: async ({ deletionId }, ctx) => {
    const deletion = await deletionById(deletionId, ctx.tx);
    if (!deletion || deletion.cancelledAt || deletion.completedAt) return;
    const organization = await organizationById(deletion.orgId);
    if (!organization) return;
    const deps = orgDeletionDependencies.get();
    for (const to of await owners(deletion.orgId)) {
      await deps.transport.send(
        await renderDeletionScheduledEmail(to, {
          organization: organization.name,
          reason: deletion.reason as "owner_request" | "contract_end",
          scheduledFor: deletion.scheduledFor,
          baseUrl: deps.baseUrl,
        }),
      );
    }
  },
});

const notifySchema = z.object({
  organization: z.string(),
  recipients: z.array(
    z.object({ email: z.string(), name: z.string(), locale: z.unknown().optional() }),
  ),
});

export const orgPurgeJob = defineJob({
  type: "org.purge",
  schema: z.object({ deletionId: z.string().min(1).max(128) }),
  timeoutMs: 240_000,
  maxAttempts: 8,
  handle: async ({ deletionId }, ctx) => {
    const deps = orgDeletionDependencies.get();
    const now = deps.now();
    const deletion = await deletionById(deletionId, ctx.tx);
    if (!deletion || deletion.cancelledAt || deletion.confirmedAt) return;
    if (deletion.scheduledFor > now) return;
    let notify = notifySchema.safeParse(deletion.notifyEmails).data ?? null;
    if (!deletion.completedAt) {
      const organization = await organizationById(deletion.orgId);
      notify = { organization: organization?.name ?? "", recipients: await owners(deletion.orgId) };
      // Stockage d'abord (idempotent) : charges brutes, pièces jointes, packs, exports, zone d'arrivée.
      await deps.store.deletePrefix(`orgs/${deletion.orgId}/`);
      await purgeOrganizationRows(ctx.tx, deletion.orgId);
    }
    for (const to of notify?.recipients ?? []) {
      await deps.transport.send(
        await renderOrgDeletedEmail(to, { organization: notify!.organization, completedAt: now }),
      );
    }
    // Les adresses ne servaient qu'à la confirmation : elles ne restent pas dans la trace.
    await ctx.tx.organizationDeletion.update({
      where: { id: deletion.id },
      data: {
        completedAt: deletion.completedAt ?? now,
        confirmedAt: now,
        notifyEmails: Prisma.DbNull,
      },
    });
  },
});

export const scheduleDeletionNotice = (deletionId: string) =>
  enqueue(
    orgDeletionNoticeJob,
    { deletionId },
    // Le cron de chaque minute l'exécute (l'avis n'a pas à partir dans la seconde).
    { dedupeKey: `org.deletionNotice:${deletionId}` },
  );

export const schedulePurge = (deletionId: string) =>
  enqueue(orgPurgeJob, { deletionId }, { dedupeKey: `org.purge:${deletionId}` });
