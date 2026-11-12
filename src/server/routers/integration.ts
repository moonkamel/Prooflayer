// Routeur `integration` (§4.4.2, rôle admin). PL-403 livre `jira.authorizeUrl` et `jira.complete` (retour du
// consentement, appelé par /api/integrations/jira/callback) ; list, resync, disconnect et la liaison des ressources
// arrivent avec PL-404 et PL-308. Aucune logique ici : src/server/services/jira-integration.ts.
import { z } from "zod";
import * as jira from "@/server/services/jira-integration";
import { adminProcedure, router } from "@/server/trpc";

export const integrationRouter = router({
  jira: router({
    authorizeUrl: adminProcedure.query(({ ctx }) => jira.jiraAuthorizeUrl(ctx)),
    complete: adminProcedure
      .input(z.object({ code: z.string().min(1).max(2048), state: z.string().min(1).max(2048) }))
      .mutation(({ ctx, input }) => jira.completeJiraAuthorization(ctx, input)),
  }),
});
