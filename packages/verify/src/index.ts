// API du paquet : vérification d'un pack (ligne de commande, page publique de vérification, scripts).
export { verifyPack, STEPS, ISSUE_CODES, MAX_ISSUES_PER_STEP } from "./verify.ts";
export type {
  VerifyReport,
  VerifyOptions,
  StepResult,
  Issue,
  IssueCode,
  StepId,
} from "./verify.ts";
export { formatReport, summaryLine } from "./format.ts";
export { MESSAGES, type Lang } from "./messages.ts";
export { PINNED_KEYS, PINNED_TSA_ROOTS } from "./trust.ts";
export type { TrustedRoot } from "./tsa.ts";
export { main, VERSION } from "./cli.ts";
