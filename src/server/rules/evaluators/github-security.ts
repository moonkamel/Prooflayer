// AIA-15-05 (`github.vulnerabilityAge`) et AIA-15-06 (`github.secretScanning`), d'après le dernier instantané des
// alertes de chaque dépôt observé (PL-305 : décomptes et dates seulement). Fonctions pures.
// - AIA-15-05 : aucune vulnérabilité critique ouverte depuis plus de criticalMaxDays jours, ni élevée depuis plus de
//   highMaxDays jours (alertes de dépendances et d'analyse de code). Alertes indisponibles sur un dépôt : absentes.
// - AIA-15-06 : détection de secrets active et aucun secret ouvert.
import { z } from "zod";
import { reason, type EvaluableControl, type EvidenceRecord, type EvaluatorEntry } from "../engine";
import type { Evaluation, EvaluationReason } from "../evaluation";
import { latestBy, missing, numberParam, parsed, result, staleness } from "./common";

const KIND = "github.security_alerts.snapshot";
const DAY_MS = 86_400_000;

const severities = z.object({
  open: z.object({ critical: z.number(), high: z.number() }).passthrough(),
  oldestOpenAt: z
    .object({ critical: z.string().nullable(), high: z.string().nullable() })
    .passthrough(),
});
const snapshot = z.object({
  dependabot: severities.nullable(),
  codeScanning: severities.nullable(),
  secretScanning: z.object({
    enabled: z.boolean(),
    open: z.number().nullable(),
    oldestOpenAt: z.string().nullable(),
  }),
});

function latestSnapshots(evidence: readonly EvidenceRecord[]) {
  return latestBy(parsed(evidence, KIND, snapshot), (s) => s.record.resourceId ?? "");
}

const noSnapshot = () =>
  missing(
    "NO_ALERTS_SNAPSHOT",
    "Aucun instantané des alertes de sécurité.",
    "No snapshot of security alerts.",
  );

export function evaluateVulnerabilityAge(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const limits = {
    critical: numberParam(control, "criticalMaxDays", 30),
    high: numberParam(control, "highMaxDays", 90),
  };
  const latest = latestSnapshots(evidence);
  if (latest.length === 0) return noSnapshot();
  const stale = staleness(
    control,
    latest.map((s) => s.record),
    now,
  );
  if (stale) return stale;
  const available = latest.filter((s) => s.data.dependabot || s.data.codeScanning);
  if (available.length === 0) {
    return missing(
      "ALERTS_UNAVAILABLE",
      "Les alertes de dépendances et d'analyse de code ne sont pas accessibles.",
      "Dependency and code scanning alerts are not accessible.",
    );
  }
  const ids = latest.map((s) => s.record.id);
  const problems: EvaluationReason[] = [];
  for (const s of available) {
    for (const severity of ["critical", "high"] as const) {
      const oldest = [s.data.dependabot, s.data.codeScanning]
        .map((source) => source?.oldestOpenAt[severity] ?? null)
        .filter((d): d is string => d !== null)
        .sort()[0];
      if (!oldest) continue;
      const age = Math.floor((now.getTime() - new Date(oldest).getTime()) / DAY_MS);
      if (age > limits[severity]) {
        const fr = severity === "critical" ? "critique" : "élevée";
        problems.push(
          reason(
            severity === "critical" ? "CRITICAL_TOO_OLD" : "HIGH_TOO_OLD",
            `Vulnérabilité ${fr} ouverte depuis ${age} jours (au plus ${limits[severity]}).`,
            `${severity === "critical" ? "Critical" : "High"} vulnerability open for ${age} days (at most ${limits[severity]}).`,
            [s.record.id],
          ),
        );
      }
    }
  }
  if (problems.length > 0) return result("FAIL", problems, ids);
  // Une partie seulement des dépôts donne accès à ses alertes : preuve partielle.
  if (available.length < latest.length) {
    return result(
      "PARTIAL",
      [
        reason(
          "ALERTS_PARTIALLY_AVAILABLE",
          `Alertes accessibles sur ${available.length} dépôt(s) sur ${latest.length}, sans vulnérabilité trop ancienne.`,
          `Alerts accessible on ${available.length} of ${latest.length} repositories, with no vulnerability open too long.`,
          ids,
        ),
      ],
      ids,
    );
  }
  return result(
    "PASS",
    [
      reason(
        "NO_OLD_VULNERABILITY",
        `Aucune vulnérabilité critique ouverte depuis plus de ${limits.critical} jours, ni élevée depuis plus de ${limits.high} jours.`,
        `No critical vulnerability open for more than ${limits.critical} days, nor high for more than ${limits.high} days.`,
        ids,
      ),
    ],
    ids,
  );
}

export function evaluateSecretScanning(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const latest = latestSnapshots(evidence);
  if (latest.length === 0) return noSnapshot();
  const stale = staleness(
    control,
    latest.map((s) => s.record),
    now,
  );
  if (stale) return stale;
  const ids = latest.map((s) => s.record.id);
  const problems: EvaluationReason[] = [];
  const unknown: string[] = [];
  for (const s of latest) {
    const scan = s.data.secretScanning;
    if (scan.enabled && scan.open === null) unknown.push(s.record.id);
    if (!scan.enabled) {
      problems.push(
        reason(
          "SECRET_SCANNING_DISABLED",
          "La détection de secrets n'est pas active sur un dépôt.",
          "Secret scanning is not enabled on a repository.",
          [s.record.id],
        ),
      );
    } else if ((scan.open ?? 0) > 0) {
      problems.push(
        reason(
          "OPEN_SECRET",
          `${scan.open} secret(s) détecté(s) et non résolu(s).`,
          `${scan.open} detected secret(s) not resolved.`,
          [s.record.id],
        ),
      );
    }
  }
  if (problems.length > 0) return result("FAIL", problems, ids);
  // Détection active mais alertes illisibles (droit absent) : l'absence de secret ouvert n'est pas établie.
  if (unknown.length > 0) {
    return result(
      "PARTIAL",
      [
        reason(
          "SECRET_ALERTS_UNAVAILABLE",
          "Détection de secrets active, mais ses alertes ne sont pas accessibles sur un dépôt.",
          "Secret scanning enabled, but its alerts are not accessible on a repository.",
          unknown,
        ),
      ],
      ids,
    );
  }
  return result(
    "PASS",
    [
      reason(
        "NO_OPEN_SECRET",
        "Détection de secrets active, aucun secret ouvert.",
        "Secret scanning enabled, no open secret.",
        ids,
      ),
    ],
    ids,
  );
}

export const vulnerabilityAgeEvaluator: EvaluatorEntry = {
  version: "github.vulnerabilityAge@1",
  evaluate: evaluateVulnerabilityAge,
};
export const secretScanningEvaluator: EvaluatorEntry = {
  version: "github.secretScanning@1",
  evaluate: evaluateSecretScanning,
};
