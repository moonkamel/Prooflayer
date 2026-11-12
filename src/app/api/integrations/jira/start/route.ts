// Début de la connexion Jira (PL-403) : redirige vers le consentement Atlassian. Même garde que l'API
// (`integration.jira.authorizeUrl`, rôle admin) ; aucune logique ici.
import { TRPCError } from "@trpc/server";
import { createContext } from "@/server/context";
import { createCaller } from "@/server/routers/_app";
import { jiraReturnPath } from "@/lib/integration-status";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const api = createCaller(await createContext(request.headers));
    const { url } = await api.integration.jira.authorizeUrl();
    return Response.redirect(url, 302);
  } catch (error) {
    if (error instanceof TRPCError) {
      return Response.redirect(new URL(jiraReturnPath(error.message), request.url), 303);
    }
    throw error;
  }
}
