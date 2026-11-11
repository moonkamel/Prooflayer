// Client tRPC de l'interface (§4.4.1). Même origine ; le cookie de session Better Auth authentifie l'appel.
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@/server/routers/_app";

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })],
});
