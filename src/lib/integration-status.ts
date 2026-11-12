// Résultat de la connexion Jira affiché sur la page Organisation (PL-403) : une liste fermée de clés traduites,
// jamais un message d'erreur brut dans l'adresse.
export const JIRA_STATUSES = [
  "connected",
  "denied",
  "invalidState",
  "exchangeFailed",
  "noUsableSite",
  "siteLinkedElsewhere",
  "notConfigured",
  "forbidden",
  "error",
] as const;
export type JiraStatus = (typeof JIRA_STATUSES)[number];

const fromReason = (reason: string): JiraStatus => {
  if (reason === "connected") return "connected";
  if (reason === "FORBIDDEN" || reason === "UNAUTHORIZED") return "forbidden";
  const key = reason.replace(/^integration\.jira\./u, "");
  return (JIRA_STATUSES as readonly string[]).includes(key) ? (key as JiraStatus) : "error";
};

export const jiraReturnPath = (reason: string) => `/organization?jira=${fromReason(reason)}`;

export const parseJiraStatus = (value: string | undefined | null): JiraStatus | null =>
  value && (JIRA_STATUSES as readonly string[]).includes(value) ? (value as JiraStatus) : null;
