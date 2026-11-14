import { createCallerFactory, router } from "@/server/trpc";
import { auditRouter } from "./audit";
import { billingRouter } from "./billing";
import { classificationRouter } from "./classification";
import { controlRouter } from "./control";
import { dashboardRouter } from "./dashboard";
import { evidenceRouter } from "./evidence";
import { exemptionRouter } from "./exemption";
import { integrationRouter } from "./integration";
import { notificationRouter } from "./notification";
import { orgRouter } from "./org";
import { packRouter } from "./pack";
import { systemRouter } from "./system";
import { watchRouter } from "./watch";

export const appRouter = router({
  org: orgRouter,
  audit: auditRouter,
  system: systemRouter,
  classification: classificationRouter,
  control: controlRouter,
  exemption: exemptionRouter,
  integration: integrationRouter,
  evidence: evidenceRouter,
  dashboard: dashboardRouter,
  notification: notificationRouter,
  pack: packRouter,
  billing: billingRouter,
  watch: watchRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
