// Contexte des procédures tRPC (§4.4.1) : la session Better Auth de la requête et ses en-têtes,
// transmis aux appels Better Auth faits au nom de l'utilisateur.
import { auth } from "./auth";

export interface SessionInfo {
  userId: string;
  activeOrganizationId: string | null;
}

export interface Context {
  session: SessionInfo | null;
  headers: Headers;
}

export async function createContext(headers: Headers): Promise<Context> {
  const result = await auth.api.getSession({ headers });
  return {
    headers,
    session: result
      ? {
          userId: result.session.userId,
          activeOrganizationId:
            (result.session as { activeOrganizationId?: string | null }).activeOrganizationId ??
            null,
        }
      : null,
  };
}
