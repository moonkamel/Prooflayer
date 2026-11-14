// Routeur `watch` (PL-603) : fil de veille, lecture pour tout membre. Aucune logique ici.
import { watchFeed } from "@/server/services/regulatory-watch";
import { orgProcedure, router } from "@/server/trpc";

export const watchRouter = router({
  list: orgProcedure.query(({ ctx }) => watchFeed(ctx)),
});
