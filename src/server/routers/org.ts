// Routeur `org` (§4.4.2) : get, update, members.list, members.invite, members.setRole, members.remove.
// Écriture : admin au minimum. Ajouts de PL-104 pour rendre les invitations révocables :
// members.invitations et members.revokeInvitation (admin).
// Aucune logique métier ici (règle 3 de CLAUDE.md) : tout est dans src/server/services/organization.ts.
import { z } from "zod";
import * as org from "@/server/services/organization";
import { ORG_ROLES } from "@/server/services/role-policy";
import { adminProcedure, orgProcedure, router } from "@/server/trpc";

const role = z.enum(ORG_ROLES as [(typeof ORG_ROLES)[number], ...(typeof ORG_ROLES)[number][]]);
const id = z.string().min(1).max(128);

export const orgRouter = router({
  get: orgProcedure.query(({ ctx }) => org.getOrganization(ctx)),
  update: adminProcedure
    .input(z.object({ name: z.string().trim().min(1).max(120) }))
    .mutation(({ ctx, input }) => org.updateOrganization(ctx, input)),
  members: router({
    list: orgProcedure.query(({ ctx }) => org.listMembers(ctx)),
    invite: adminProcedure
      .input(z.object({ email: z.email().max(254), role }))
      .mutation(({ ctx, input }) => org.inviteMember(ctx, input)),
    setRole: adminProcedure
      .input(z.object({ memberId: id, role }))
      .mutation(({ ctx, input }) => org.setMemberRole(ctx, input)),
    remove: adminProcedure
      .input(z.object({ memberId: id }))
      .mutation(({ ctx, input }) => org.removeMember(ctx, input)),
    invitations: adminProcedure.query(({ ctx }) => org.listPendingInvitations(ctx)),
    revokeInvitation: adminProcedure
      .input(z.object({ invitationId: id }))
      .mutation(({ ctx, input }) => org.revokeInvitation(ctx, input)),
  }),
});
