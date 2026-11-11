// Routeur `audit` (§4.4.2) : list, export. Rôle minimal : admin (§3.2 E10 : consultable et exportable par owner et admin).
// Aucune logique ici (règle 3 de CLAUDE.md) : src/server/services/audit.ts.
import { z } from "zod";
import * as audit from "@/server/services/audit";
import { adminProcedure, router } from "@/server/trpc";

const filters = z.object({
  action: z.enum(audit.AUDIT_ACTIONS).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export const auditRouter = router({
  list: adminProcedure
    .input(
      filters.extend({
        cursor: z.string().max(64).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(({ ctx, input }) =>
      audit.listAuditWithActors(ctx.db, audit.parseAuditFilters(input), {
        limit: input.limit,
        cursor: input.cursor,
      }),
    ),
  export: adminProcedure
    .input(filters)
    .query(({ ctx, input }) => audit.exportAuditWithActors(ctx.db, audit.parseAuditFilters(input))),
});
