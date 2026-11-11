import { createCallerFactory, router } from "@/server/trpc";
import { auditRouter } from "./audit";
import { classificationRouter } from "./classification";
import { orgRouter } from "./org";
import { systemRouter } from "./system";

export const appRouter = router({
  org: orgRouter,
  audit: auditRouter,
  system: systemRouter,
  classification: classificationRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
