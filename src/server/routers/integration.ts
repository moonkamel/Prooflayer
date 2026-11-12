// Routeur `integration` (§4.4.2, rôle admin). PL-403 : `jira.authorizeUrl` et `jira.complete` (retour du consentement,
// appelé par /api/integrations/jira/callback). PL-404 : `jira.previewQuery`, `jira.mappings` (lecture, tout membre) et
// `jira.saveMapping`. list, resync, disconnect et GitHub arrivent avec PL-301 et PL-308. Aucune logique ici.
import { z } from "zod";
import { JIRA_PURPOSES } from "@/server/connectors/jira/normalizers";
import * as jira from "@/server/services/jira-integration";
import * as mappings from "@/server/services/jira-mappings";
import { scheduleFullReconcile } from "@/server/system/jira-schedule";
import { adminProcedure, orgProcedure, router } from "@/server/trpc";

const id = z.string().min(1).max(128);
const jql = z.string().min(1).max(mappings.MAX_JQL);

export const integrationRouter = router({
  jira: router({
    authorizeUrl: adminProcedure.query(({ ctx }) => jira.jiraAuthorizeUrl(ctx)),
    complete: adminProcedure
      .input(z.object({ code: z.string().min(1).max(2048), state: z.string().min(1).max(2048) }))
      .mutation(({ ctx, input }) => jira.completeJiraAuthorization(ctx, input)),
    mappings: orgProcedure
      .input(z.object({ systemId: id }))
      .query(({ ctx, input }) => mappings.jiraMappings(ctx, input)),
    previewQuery: adminProcedure
      .input(z.object({ integrationId: id, jql }))
      .mutation(({ ctx, input }) => mappings.previewJiraQuery(ctx, input)),
    saveMapping: adminProcedure
      .input(
        z.object({
          systemId: id,
          purpose: z.enum(JIRA_PURPOSES),
          jql,
          acceptanceField: z.string().max(64).nullable().optional(),
        }),
      )
      .mutation(({ ctx, input }) => mappings.saveJiraMapping(ctx, input, scheduleFullReconcile)),
  }),
});
