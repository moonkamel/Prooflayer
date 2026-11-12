// Normaliseur `github.security_alerts.snapshot` : alertes ouvertes par gravité et ancienneté (Dependabot, analyse de
// code, détection de secrets), d'après l'API REST. Sert à AIA-15-05 et AIA-15-06. Liste blanche : des décomptes et
// des dates seulement ; jamais la valeur d'un secret, ni un chemin, ni un paquet.
import { z } from "zod";
import { contentSha256 } from "@/server/seal/evidence";
import {
  dayOf,
  parse,
  repositorySchema,
  type GitHubEvidence,
  type NormalizerContext,
} from "./common";

export const SECURITY_ALERTS_SNAPSHOT = "github.security_alerts.snapshot";

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
type Severity = (typeof SEVERITIES)[number];

const alert = z.object({ state: z.string(), created_at: z.string().datetime() });
const dependabot = alert.extend({
  security_advisory: z.object({ severity: z.string() }).partial().optional(),
  security_vulnerability: z.object({ severity: z.string() }).partial().optional(),
});
const codeScanning = alert.extend({
  rule: z.object({ security_severity_level: z.string().nullable().optional() }).optional(),
});

const schema = z.object({
  repository: repositorySchema,
  takenAt: z.string().datetime(),
  dependabot: z.array(dependabot).nullable(),
  codeScanning: z.array(codeScanning).nullable(),
  secretScanning: z.array(alert).nullable(),
  secretScanningEnabled: z.boolean(),
});

function bySeverity(alerts: { severity: string | null; createdAt: string }[]) {
  const open = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
  const oldest: Record<Severity, string | null> = {
    critical: null,
    high: null,
    medium: null,
    low: null,
  };
  for (const a of alerts) {
    const severity = (SEVERITIES as readonly string[]).includes(a.severity ?? "")
      ? (a.severity as Severity)
      : "low";
    open[severity] += 1;
    const at = new Date(a.createdAt).toISOString();
    if (!oldest[severity] || at < oldest[severity]) oldest[severity] = at;
  }
  return { open, oldestOpenAt: oldest };
}

export function normalizeSecurityAlertsSnapshot(
  payload: unknown,
  ctx: NormalizerContext,
): GitHubEvidence[] {
  const snapshot = parse(schema, payload, SECURITY_ALERTS_SNAPSHOT, ctx);
  if (!snapshot) return [];
  const isOpen = (a: { state: string }) => a.state === "open";
  const state = {
    // null : alertes non disponibles (fonction désactivée ou droit absent), à distinguer de « aucune alerte ».
    dependabot: snapshot.dependabot
      ? bySeverity(
          snapshot.dependabot.filter(isOpen).map((a) => ({
            severity: a.security_vulnerability?.severity ?? a.security_advisory?.severity ?? null,
            createdAt: a.created_at,
          })),
        )
      : null,
    codeScanning: snapshot.codeScanning
      ? bySeverity(
          snapshot.codeScanning.filter(isOpen).map((a) => ({
            severity: a.rule?.security_severity_level ?? null,
            createdAt: a.created_at,
          })),
        )
      : null,
    secretScanning: {
      enabled: snapshot.secretScanningEnabled,
      open: snapshot.secretScanning ? snapshot.secretScanning.filter(isOpen).length : null,
      oldestOpenAt:
        snapshot.secretScanning
          ?.filter(isOpen)
          .map((a) => new Date(a.created_at).toISOString())
          .sort()[0] ?? null,
    },
  };
  const fingerprint = contentSha256(state).toString("hex").slice(0, 16);
  const repo = snapshot.repository;
  return [
    {
      kind: SECURITY_ALERTS_SNAPSHOT,
      source: "GITHUB",
      capturedVia: ctx.capturedVia,
      resourceId: ctx.resourceId,
      sourceRef: `${repo.id}/security`,
      sourceUrl: `https://github.com/${repo.full_name}/security`,
      dedupeKey: `gh:alerts:${repo.id}:${dayOf(snapshot.takenAt)}:${fingerprint}`,
      occurredAt: new Date(snapshot.takenAt),
      summary: `Alertes de sécurité ouvertes : ${state.dependabot?.open.critical ?? 0} critique(s) Dependabot`,
      actor: null,
      payload: { ...state, takenAt: new Date(snapshot.takenAt).toISOString() },
    },
  ];
}
