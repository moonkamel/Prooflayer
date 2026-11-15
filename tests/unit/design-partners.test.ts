// PL-610 — Relevé des design partners (pur) : quatre métriques du §1.4 par partenaire et pour la cohorte active,
// règle de remplacement du §7.5 (GitHub non connecté deux semaines après l'ouverture).
import { describe, expect, it } from "vitest";
import { cohortReport, type PartnerFacts } from "@/server/services/design-partners-data";
import { orgFunnel } from "@/server/services/funnel-data";

const start = new Date("2026-11-01T09:00:00Z");
const now = new Date("2026-11-20T09:00:00Z");
const funnel = (minutes: number | null, share: number | null) => ({
  ...orgFunnel([], []),
  firstEvidenceMinutes: minutes,
  automated: { evaluated: 0, applicable: 0, share },
});
const partner = (over: Partial<PartnerFacts>): PartnerFacts => ({
  orgId: "org",
  name: "Partenaire",
  segment: "hr_tech",
  pilotStartedAt: start,
  sessionAt: start,
  packSharedAt: null,
  packAudience: null,
  replacedAt: null,
  githubConnectedAt: start,
  paying: false,
  funnel: funnel(10, 0.5),
  ...over,
});

describe("design partners", () => {
  it("à remplacer : GitHub non connecté après 14 jours ; jamais un partenaire déjà remplacé", () => {
    const { partners } = cohortReport(
      [
        partner({ orgId: "a", githubConnectedAt: null }),
        partner({ orgId: "b" }),
        partner({ orgId: "c", githubConnectedAt: null, replacedAt: now }),
        partner({
          orgId: "d",
          githubConnectedAt: null,
          pilotStartedAt: new Date("2026-11-10T09:00:00Z"),
        }),
      ],
      now,
    );
    expect(partners.map((p) => [p.orgId, p.replaceDue])).toEqual([
      ["a", true],
      ["b", false],
      ["c", false],
      ["d", false],
    ]);
    expect(partners[0]!.pilotEndsAt).toEqual(new Date("2027-01-24T09:00:00Z"));
  });

  it("cohorte active : quatre métriques et seuils (3 sur 5) ; remplacés exclus", () => {
    const { cohort } = cohortReport(
      [
        partner({
          orgId: "a",
          packSharedAt: now,
          packAudience: "client",
          paying: true,
          funnel: funnel(8, 0.45),
        }),
        partner({
          orgId: "b",
          packSharedAt: now,
          packAudience: "auditor",
          paying: true,
          funnel: funnel(12, 0.4),
        }),
        partner({
          orgId: "c",
          packSharedAt: now,
          packAudience: "investor",
          funnel: funnel(30, 0.2),
        }),
        partner({ orgId: "d", paying: true, funnel: funnel(14, 0.5), segment: "fintech" }),
        partner({ orgId: "e", funnel: funnel(9, 0.6), segment: "exemption", sessionAt: null }),
        partner({ orgId: "x", replacedAt: now, packSharedAt: now, paying: true }),
      ],
      now,
    );
    expect(cohort).toEqual({
      active: 5,
      sessionsDone: 4,
      segments: { hr_tech: 3, fintech: 1, exemption: 1 },
      medianFirstEvidenceMinutes: 12,
      medianAutomatedShare: 0.45,
      packShared: 3,
      paying: 3,
      thresholds: { firstEvidence: true, automatedShare: true, packShared: true, paying: true },
    });
  });

  it("cohorte vide : aucun verdict", () => {
    expect(cohortReport([], now).cohort.thresholds).toEqual({
      firstEvidence: null,
      automatedShare: null,
      packShared: null,
      paying: null,
    });
  });
});
