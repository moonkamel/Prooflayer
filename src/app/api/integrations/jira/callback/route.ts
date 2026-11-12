// Retour du consentement Atlassian (PL-403, §4.5.2) : `integration.jira.complete` vérifie le `state` contre la
// session, échange le code et enregistre l'intégration. Redirection vers l'organisation avec le résultat.
import { TRPCError } from "@trpc/server";
import { createContext } from "@/server/context";
import { createCaller } from "@/server/routers/_app";
import { jiraReturnPath } from "@/lib/integration-status";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const state = params.get("state");
  // Consentement refusé ou interrompu par l'utilisateur.
  if (!code || !state)
    return Response.redirect(new URL(jiraReturnPath("integration.jira.denied"), request.url), 303);
  try {
    const api = createCaller(await createContext(request.headers));
    await api.integration.jira.complete({ code, state });
    return Response.redirect(new URL(jiraReturnPath("connected"), request.url), 303);
  } catch (error) {
    if (error instanceof TRPCError) {
      return Response.redirect(new URL(jiraReturnPath(error.message), request.url), 303);
    }
    throw error;
  }
}
