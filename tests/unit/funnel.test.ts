// PL-608 — Entonnoir (pur) : étapes, délai inscription → première preuve, part des contrôles évalués
// automatiquement (connecteurs seulement, preuve présente), médianes et seuils du §1.4 ; envoi PostHog pseudonymisé.
import { describe, expect, it } from "vitest";
import { automatedShare, funnelSummary, median, orgFunnel } from "@/server/services/funnel-data";
import { analyticsConfig, captureBody, pseudonymousOrg } from "@/server/system/jobs/analytics";

const at = (iso: string) => new Date(iso);

describe("entonnoir d'une organisation", () => {
  it("délai inscription → première preuve en minutes ; étape manquante : null", () => {
    const f = orgFunnel(
      [
        { name: "signup", occurredAt: at("2026-11-15T10:00:00Z") },
        { name: "first_evidence", occurredAt: at("2026-11-15T10:12:30Z") },
        { name: "inconnu", occurredAt: at("2026-11-15T09:00:00Z") },
      ],
      [],
    );
    expect(f.firstEvidenceMinutes).toBe(12.5);
    expect(f.steps.first_pack).toBeNull();
    expect(
      orgFunnel([{ name: "signup", occurredAt: at("2026-11-15T10:00:00Z") }], [])
        .firstEvidenceMinutes,
    ).toBeNull();
  });

  it("évalués automatiquement : connecteur et preuve présente ; non applicables hors dénominateur", () => {
    expect(
      automatedShare([
        { notApplicable: false, status: "PASS", evaluatorKey: "github.peerReview" },
        { notApplicable: false, status: "FAIL", evaluatorKey: "jira.riskRegister" },
        { notApplicable: false, status: "MISSING", evaluatorKey: "github.branchProtection" },
        { notApplicable: false, status: "PASS", evaluatorKey: "manual.evidencePresent" },
        { notApplicable: false, status: "PASS", evaluatorKey: "internal.exemptionDossier" },
        { notApplicable: true, status: "NOT_APPLICABLE", evaluatorKey: "github.releases" },
      ]),
    ).toEqual({ evaluated: 2, applicable: 5, share: 0.4 });
    expect(automatedShare([]).share).toBeNull();
  });
});

describe("synthèse", () => {
  it("médiane paire et impaire", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([10, 20, 1, 30])).toBe(15);
  });

  it("seuils du §1.4 : < 15 min et ≥ 40 %", () => {
    const org = (minutes: number | null, share: number | null) => ({
      ...orgFunnel([], []),
      firstEvidenceMinutes: minutes,
      automated: { evaluated: 0, applicable: 0, share },
    });
    const summary = funnelSummary([org(10, 0.5), org(14, 0.4), org(40, 0.1), org(null, null)]);
    expect(summary).toMatchObject({
      organizations: 4,
      medianFirstEvidenceMinutes: 14,
      medianAutomatedShare: 0.4,
      thresholds: { firstEvidence: true, automatedShare: true },
    });
    expect(funnelSummary([]).thresholds).toEqual({ firstEvidence: null, automatedShare: null });
  });
});

describe("PostHog", () => {
  it("inactif sans clé ; hôte UE par défaut ; hôte non https refusé", () => {
    expect(analyticsConfig({ BETTER_AUTH_SECRET: "s" })).toBeNull();
    expect(analyticsConfig({ POSTHOG_API_KEY: "phc_x", BETTER_AUTH_SECRET: "s" })?.host).toBe(
      "https://eu.i.posthog.com",
    );
    expect(
      analyticsConfig({
        POSTHOG_API_KEY: "phc_x",
        BETTER_AUTH_SECRET: "s",
        POSTHOG_HOST: "http://x",
      }),
    ).toBeNull();
  });

  it("corps envoyé : organisation pseudonymisée, étape, date, uuid ; rien d'autre", () => {
    const config = { apiKey: "phc_x", host: "https://eu.i.posthog.com", secret: "s" };
    const body = captureBody(config, {
      id: "6f1c2d3e-0000-4000-8000-000000000000",
      orgId: "org_talvio",
      name: "first_evidence",
      occurredAt: at("2026-11-15T10:12:30Z"),
    });
    expect(body).toEqual({
      api_key: "phc_x",
      event: "funnel_first_evidence",
      distinct_id: pseudonymousOrg("org_talvio", "s"),
      uuid: "6f1c2d3e-0000-4000-8000-000000000000",
      timestamp: "2026-11-15T10:12:30.000Z",
      properties: { $process_person_profile: false },
    });
    expect(body.distinct_id).not.toContain("talvio");
    expect(pseudonymousOrg("org_talvio", "s")).toBe(pseudonymousOrg("org_talvio", "s"));
  });
});
