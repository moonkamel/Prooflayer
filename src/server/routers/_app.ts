import { createCallerFactory, router } from "@/server/trpc";
import { auditRouter } from "./audit";
import { orgRouter } from "./org";

export const appRouter = router({
  org: orgRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
