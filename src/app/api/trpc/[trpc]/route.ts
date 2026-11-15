import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createContext } from "@/server/context";
import { appRouter } from "@/server/routers/_app";
import { consume, ipKey, RATE_RULES, requestIp, tooManyRequests } from "@/server/system/rate-limit";

export const runtime = "nodejs";

// PL-605 : limitation de débit de l'API par adresse IP, avant toute lecture de session.
const handler = async (req: Request) => {
  const decision = await consume(`api:${ipKey(requestIp(req.headers))}`, RATE_RULES.api);
  if (!decision.allowed) return tooManyRequests(decision);
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext(req.headers),
  });
};

export { handler as GET, handler as POST };
