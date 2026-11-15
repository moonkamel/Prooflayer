// Registre des types de jobs de l'application. Chaque ticket qui ajoute un traitement différé y enregistre son
// type (« github.backfill », « control.evaluate », « seal.org », « pack.build »… §4.3.2).
import { analyticsCaptureJob } from "./analytics";
import { controlEvaluateJob, controlSweepOrgJob } from "./control-evaluate";
import { jiraIssueSyncJob, jiraReconcileJob, jiraWebhookEnsureJob } from "./jira";
import { notificationDigestJob, notificationEmailJob } from "./notifications";
import { orgDeletionNoticeJob, orgPurgeJob } from "./org-deletion";
import { orgExportJob } from "./org-export";
import { packBuildJob } from "./pack";
import { publicClassifierNoteJob } from "./public-classifier-note";
import { sealAnchorJob, sealOrgJob, sealVerifyAnchorsJob, sealVerifyOrgJob } from "./seal";
import { JobRegistry } from "./registry";
import { watchNotifyJob } from "./watch";

export const jobRegistry = new JobRegistry()
  .register(publicClassifierNoteJob)
  .register(controlEvaluateJob)
  .register(controlSweepOrgJob)
  .register(jiraIssueSyncJob)
  .register(jiraReconcileJob)
  .register(jiraWebhookEnsureJob)
  .register(notificationEmailJob)
  .register(notificationDigestJob)
  .register(sealOrgJob)
  .register(sealAnchorJob)
  .register(sealVerifyOrgJob)
  .register(sealVerifyAnchorsJob)
  .register(packBuildJob)
  .register(watchNotifyJob)
  .register(orgExportJob)
  .register(orgDeletionNoticeJob)
  .register(orgPurgeJob)
  .register(analyticsCaptureJob);
