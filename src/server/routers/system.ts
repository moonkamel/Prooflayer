// Routeur `system` (§4.4.2) : list, get, create, update, archive, designChanges.list, designChanges.qualify.
// Écriture : admin au minimum. Ajouts de PL-201 : history (onglet « Historique » de l'écran B), export (CSV et JSON,
// §3.2 E2) et designChanges.create (saisie manuelle, avant le connecteur GitHub du sprint 3).
// setMonitored arrive avec la limite de systèmes surveillés du plan (§3.2 E11).
// Aucune logique métier ici (règle 3 de CLAUDE.md) : src/server/services/systems.ts.
import { z } from "zod";
import * as systems from "@/server/services/systems";
import { AI_ACT_ROLES, SYSTEM_STATUSES } from "@/server/services/system-registry";
import { adminProcedure, orgProcedure, router } from "@/server/trpc";

const id = z.string().min(1).max(128);
const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();

const patch = z
  .object({
    name: text(120),
    intendedPurpose: text(2000),
    description: optionalText(4000),
    role: z.enum(AI_ACT_ROLES),
    status: z.enum(SYSTEM_STATUSES),
    placedOnMarketAt: z.iso
      .date()
      .transform((d) => new Date(`${d}T00:00:00.000Z`))
      .nullable(),
    ownerUserId: id,
    oversightOwnerUserId: id.nullable(),
    vendorName: optionalText(200),
    models: z
      .array(
        z.object({
          name: text(200),
          provider: z.string().trim().max(200),
          version: z.string().trim().max(100),
          isGpai: z.boolean(),
        }),
      )
      .max(50),
    dataCategories: z.array(z.string().trim().max(120)).max(50),
  })
  .partial()
  .strict();

export const systemRouter = router({
  list: orgProcedure
    .input(
      z.object({ includeArchived: z.boolean().default(false) }).default({ includeArchived: false }),
    )
    .query(({ ctx, input }) => systems.listSystems(ctx, input)),
  get: orgProcedure
    .input(z.object({ id }))
    .query(({ ctx, input }) => systems.getSystem(ctx, input)),
  history: orgProcedure
    .input(z.object({ id }))
    .query(({ ctx, input }) => systems.systemHistory(ctx, input)),
  export: orgProcedure
    .input(z.object({ format: z.enum(["csv", "json"]) }))
    .query(({ ctx, input }) => systems.exportRegistry(ctx, input)),
  create: adminProcedure
    .input(z.object({ name: text(120), intendedPurpose: text(2000), ownerUserId: id }))
    .mutation(({ ctx, input }) => systems.createSystem(ctx, input)),
  update: adminProcedure
    .input(z.object({ id, patch }))
    .mutation(({ ctx, input }) => systems.updateSystem(ctx, input)),
  archive: adminProcedure
    .input(z.object({ id }))
    .mutation(({ ctx, input }) => systems.archiveSystem(ctx, input)),
  designChanges: router({
    list: orgProcedure
      .input(z.object({ systemId: id }))
      .query(({ ctx, input }) => systems.listDesignChanges(ctx, input)),
    create: adminProcedure
      .input(
        z.object({
          systemId: id,
          occurredAt: z.iso.date().transform((d) => new Date(`${d}T00:00:00.000Z`)),
          summary: text(2000),
        }),
      )
      .mutation(({ ctx, input }) => systems.recordDesignChange(ctx, input)),
    qualify: adminProcedure
      .input(z.object({ id, isSignificant: z.boolean(), reason: text(2000) }))
      .mutation(({ ctx, input }) => systems.qualifyDesignChange(ctx, input)),
  }),
});
