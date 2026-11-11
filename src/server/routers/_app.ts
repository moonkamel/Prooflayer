import { createCallerFactory, router } from "@/server/trpc";
import { orgRouter } from "./org";

export const appRouter = router({
  org: orgRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
