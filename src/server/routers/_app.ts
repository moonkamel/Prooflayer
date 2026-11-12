import { createCallerFactory, router } from "@/server/trpc";
import { auditRouter } from "./audit";
import { classificationRouter } from "./classification";
import { controlRouter } from "./control";
import { evidenceRouter } from "./evidence";
import { exemptionRouter } from "./exemption";
import { integrationRouter } from "./integration";
import { orgRouter } from "./org";
import { systemRouter } from "./system";

export const appRouter = router({
  org: orgRouter,
  audit: auditRouter,
  system: systemRouter,
  classification: classificationRouter,
  control: controlRouter,
  exemption: exemptionRouter,
  integration: integrationRouter,
  evidence: evidenceRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
