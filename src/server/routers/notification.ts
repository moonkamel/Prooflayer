// Routeur `notification` (§4.4.2, tout membre) : list, markRead, preferences.get, preferences.set. Aucune logique
// ici : src/server/services/notifications.ts.
import { z } from "zod";
import * as notifications from "@/server/services/notifications";
import { orgProcedure, router, withRole } from "@/server/trpc";

const anyMember = withRole("owner", "admin", "contributor", "auditor");

export const notificationRouter = router({
  list: orgProcedure.query(({ ctx }) => notifications.listNotifications(ctx)),
  markRead: anyMember
    .input(z.object({ ids: z.array(z.string().min(1).max(128)).min(1).max(100) }))
    .mutation(({ ctx, input }) => notifications.markRead(ctx, input)),
  preferences: router({
    get: orgProcedure.query(({ ctx }) => notifications.getPreferences(ctx)),
    set: anyMember
      .input(z.object({ controlFailedEmail: z.boolean(), dailyDigestEmail: z.boolean() }))
      .mutation(({ ctx, input }) => notifications.setPreferences(ctx, input)),
  }),
});
