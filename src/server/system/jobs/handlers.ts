// Registre des types de jobs de l'application. Chaque ticket qui ajoute un traitement différé y enregistre son
// type (« github.backfill », « control.evaluate », « seal.org », « pack.build »… §4.3.2).
import { controlEvaluateJob, controlSweepOrgJob } from "./control-evaluate";
import { jiraIssueSyncJob, jiraReconcileJob, jiraWebhookEnsureJob } from "./jira";
import { notificationDigestJob, notificationEmailJob } from "./notifications";
import { publicClassifierNoteJob } from "./public-classifier-note";
import { sealAnchorJob, sealOrgJob } from "./seal";
import { JobRegistry } from "./registry";

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
  .register(sealAnchorJob);
