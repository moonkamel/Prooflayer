// PL-404 — Évaluateurs Jira : au moins succès, échec, périmé, absent pour chacun (DoD du sprint 4), sur des
// instantanés jira.issue.snapshot tels que les produit le normaliseur.
import { describe, expect, it } from "vitest";
import type { EvaluableControl, EvidenceRecord } from "@/server/rules/engine";
import { EVALUATORS } from "@/server/rules/evaluators";
import {
  evaluateIncidentCorrectiveAction,
  evaluateMonitoringReviewed,
  evaluateRiskMitigationLinked,
  evaluateRiskRegisterExists,
  evaluateRiskRegisterReviewed,
  evaluateSeriousIncidentNotified,
} from "@/server/rules/evaluators/jira";
import { EVALUATOR_KEYS } from "@/server/rules/evaluator-keys";
import { CONTROL_LIBRARY } from "@/server/rules/library";

const now = new Date("2026-11-12T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);

function controlOf(key: string, overrides: Partial<EvaluableControl> = {}): EvaluableControl {
  const c = CONTROL_LIBRARY.find((d) => d.key === key)!;
  return {
    key: c.key,
    evaluatorKey: c.evaluatorKey,
    evidenceKinds: c.evidenceKinds,
    freshnessDays: c.freshnessDays,
    params: c.params,
    ...overrides,
  };
}

let seq = 0;
/** Instantané d'un ticket, capturé `capturedDaysAgo` jours avant `now`. */
function issue(
  purpose: string,
  fields: Record<string, unknown> = {},
  capturedDaysAgo = 0,
): EvidenceRecord {
  seq += 1;
  const at = daysAgo(capturedDaysAgo);
  return {
    id: `ev_${seq}`,
    kind: "jira.issue.snapshot",
    resourceId: `res_${purpose}`,
    occurredAt: at,
    capturedAt: at,
    payload: {
      issueId: String(1000 + seq),
      key: `AIR-${seq}`,
      project: "AIR",
      purpose,
      inMapping: true,
      title: "t",
      issueType: "Task",
      status: "Open",
      statusCategory: "new",
      priority: "Medium",
      labels: [],
      assigneeAccountId: null,
      resolution: null,
      resolutionDate: null,
      created: daysAgo(30).toISOString(),
      updated: daysAgo(1).toISOString(),
      links: [],
      statusHistory: [],
      ...fields,
    },
    declarative: false,
    validUntil: null,
    linkedByUser: false,
  };
}
/** Nouvel instantané du même ticket (même issueId), plus récent. */
const later = (
  base: EvidenceRecord,
  fields: Record<string, unknown>,
  capturedDaysAgo = 0,
): EvidenceRecord => {
  const next = issue((base.payload as { purpose: string }).purpose, {}, capturedDaysAgo);
  return { ...next, payload: { ...(base.payload as object), ...fields } };
};

describe("registre", () => {
  it("les 6 évaluateurs Jira de PL-404 sont livrés", () => {
    const keys = Object.entries(EVALUATOR_KEYS)
      .filter(([, t]) => t === "PL-404")
      .map(([k]) => k);
    expect(keys).toHaveLength(6);
    for (const key of keys) expect(EVALUATORS[key as keyof typeof EVALUATORS], key).toBeDefined();
  });
});

describe("AIA-09-01 jira.riskRegisterExists", () => {
  const c = controlOf("AIA-09-01");
  it("succès : au moins un risque dans le registre", () => {
    expect(evaluateRiskRegisterExists(c, [issue("risks")], now).status).toBe("PASS");
  });
  it("échec : tous les risques sont sortis du registre", () => {
    const r = issue("risks", {}, 3);
    expect(evaluateRiskRegisterExists(c, [r, later(r, { inMapping: false })], now)).toMatchObject({
      status: "FAIL",
      reasons: [{ code: "EMPTY_RISK_REGISTER" }],
    });
  });
  it("périmé : synchronisation interrompue au-delà de la durée de fraîcheur", () => {
    expect(
      evaluateRiskRegisterExists({ ...c, freshnessDays: 7 }, [issue("risks", {}, 10)], now).status,
    ).toBe("STALE");
  });
  it("absent : aucun ticket de risque (un incident ne compte pas)", () => {
    expect(evaluateRiskRegisterExists(c, [issue("incidents")], now)).toMatchObject({
      status: "MISSING",
      reasons: [{ code: "NO_RISK_REGISTER" }],
    });
  });
});

describe("AIA-09-02 jira.riskRegisterReviewed", () => {
  const c = controlOf("AIA-09-02");
  it("succès : activité sur un risque il y a moins de 90 jours", () => {
    expect(
      evaluateRiskRegisterReviewed(
        c,
        [
          issue("risks", { updated: daysAgo(150).toISOString() }),
          issue("risks", { updated: daysAgo(20).toISOString() }),
        ],
        now,
      ),
    ).toMatchObject({ status: "PASS", reasons: [{ code: "RISK_REGISTER_REVIEWED" }] });
  });
  it("échec : registre non revu depuis 5 mois (cas Talvio)", () => {
    const r = evaluateRiskRegisterReviewed(
      c,
      [issue("risks", { updated: daysAgo(150).toISOString() })],
      now,
    );
    expect(r).toMatchObject({ status: "FAIL", reasons: [{ code: "RISK_REGISTER_NOT_REVIEWED" }] });
    expect(r.reasons[0]!.message.fr).toContain("150 jours");
  });
  it("périmé : dernière capture plus vieille que 90 jours", () => {
    expect(evaluateRiskRegisterReviewed(c, [issue("risks", {}, 95)], now).status).toBe("STALE");
  });
  it("absent : aucun ticket de risque", () => {
    expect(evaluateRiskRegisterReviewed(c, [], now).status).toBe("MISSING");
  });
});

describe("AIA-09-03 jira.riskMitigationLinked", () => {
  const c = controlOf("AIA-09-03");
  const link = [{ type: "Relates", direction: "outward", key: "ENG-1" }];
  it("succès : chaque risque élevé a une mesure liée et une acceptation nommée", () => {
    expect(
      evaluateRiskMitigationLinked(
        c,
        [
          issue("risks", { priority: "High", links: link, acceptedByAccountId: "acc1" }),
          issue("risks", { priority: "Low" }),
        ],
        now,
      ),
    ).toMatchObject({ status: "PASS", reasons: [{ code: "HIGH_RISKS_MITIGATED" }] });
    expect(
      evaluateRiskMitigationLinked(c, [issue("risks", { priority: "Low" })], now).reasons[0]!.code,
    ).toBe("NO_HIGH_RISK");
  });
  it("échec : risque élevé sans mesure liée, ou sans acceptation", () => {
    const r = evaluateRiskMitigationLinked(
      c,
      [
        issue("risks", { priority: "Highest", links: [], acceptedByAccountId: "acc1" }),
        issue("risks", { priority: "High", links: link, acceptedByAccountId: null }),
      ],
      now,
    );
    expect(r.status).toBe("FAIL");
    expect(r.reasons.map((x) => x.code).sort()).toEqual([
      "HIGH_RISK_ISSUES",
      "NO_MITIGATION",
      "NO_RESIDUAL_ACCEPTANCE",
    ]);
  });
  it("partiel : mesures liées, mais champ d'acceptation non configuré", () => {
    expect(
      evaluateRiskMitigationLinked(c, [issue("risks", { priority: "High", links: link })], now),
    ).toMatchObject({
      status: "PARTIAL",
      reasons: [{ code: "ACCEPTANCE_NOT_CONFIGURED" }],
    });
  });
  it("périmé, absent", () => {
    expect(
      evaluateRiskMitigationLinked({ ...c, freshnessDays: 7 }, [issue("risks", {}, 9)], now).status,
    ).toBe("STALE");
    expect(evaluateRiskMitigationLinked(c, [], now).status).toBe("MISSING");
  });
});

describe("AIA-20-01 jira.incidentCorrectiveAction", () => {
  const c = controlOf("AIA-20-01");
  const done = { statusCategory: "done" };
  it("succès : chaque incident clos est lié à une action corrective ; un incident ouvert n'est pas exigé", () => {
    expect(
      evaluateIncidentCorrectiveAction(
        c,
        [
          issue("incidents", {
            ...done,
            links: [{ type: "Corrective action", direction: "outward", key: "ENG-9" }],
          }),
          issue("incidents"),
        ],
        now,
      ),
    ).toMatchObject({ status: "PASS", reasons: [{ code: "INCIDENTS_ACTIONED" }] });
    expect(evaluateIncidentCorrectiveAction(c, [issue("incidents")], now).reasons[0]!.code).toBe(
      "NO_CLOSED_INCIDENT",
    );
  });
  it("échec : incident clos sans lien", () => {
    expect(evaluateIncidentCorrectiveAction(c, [issue("incidents", done)], now)).toMatchObject({
      status: "FAIL",
      reasons: [{ code: "CLOSED_WITHOUT_ACTION" }, { code: "CLOSED_WITHOUT_ACTION_COUNT" }],
    });
  });
  it("périmé, absent", () => {
    expect(
      evaluateIncidentCorrectiveAction({ ...c, freshnessDays: 7 }, [issue("incidents", {}, 9)], now)
        .status,
    ).toBe("STALE");
    expect(evaluateIncidentCorrectiveAction(c, [issue("risks")], now).status).toBe("MISSING");
  });
});

describe("AIA-72-02 jira.monitoringReviewed", () => {
  const c = controlOf("AIA-72-02");
  const done = (days: number) => ({
    statusCategory: "done",
    resolutionDate: daysAgo(days).toISOString(),
  });
  it("succès : revue terminée il y a moins de 92 jours", () => {
    expect(
      evaluateMonitoringReviewed(
        c,
        [issue("monitoring_reviews", done(200)), issue("monitoring_reviews", done(40))],
        now,
      ),
    ).toMatchObject({
      status: "PASS",
      reasons: [{ code: "MONITORING_REVIEWED" }],
    });
  });
  it("échec : dernière revue trop ancienne, ou aucune terminée", () => {
    expect(
      evaluateMonitoringReviewed(c, [issue("monitoring_reviews", done(120))], now).reasons[0]!.code,
    ).toBe("REVIEW_OVERDUE");
    expect(evaluateMonitoringReviewed(c, [issue("monitoring_reviews")], now).reasons[0]!.code).toBe(
      "NO_COMPLETED_REVIEW",
    );
  });
  it("périmé : dernière capture plus vieille que 92 jours", () => {
    expect(
      evaluateMonitoringReviewed(c, [issue("monitoring_reviews", done(10), 100)], now).status,
    ).toBe("STALE");
  });
  it("absent", () => {
    expect(evaluateMonitoringReviewed(c, [], now).status).toBe("MISSING");
  });
});

describe("AIA-73-01 jira.seriousIncidentNotified", () => {
  const c = controlOf("AIA-73-01");
  const serious = (
    createdDaysAgo: number,
    notifiedAfterDays: number | null,
    labels: string[] = [],
  ) =>
    issue("incidents", {
      labels: ["serious-incident", ...labels],
      created: daysAgo(createdDaysAgo).toISOString(),
      statusHistory:
        notifiedAfterDays === null
          ? []
          : [
              {
                at: daysAgo(createdDaysAgo - notifiedAfterDays).toISOString(),
                from: "Analyse",
                to: "Notifié",
              },
            ],
    });
  it("succès : notifié dans les 15 jours ; aucun incident grave", () => {
    expect(evaluateSeriousIncidentNotified(c, [serious(60, 8)], now).status).toBe("PASS");
    expect(evaluateSeriousIncidentNotified(c, [issue("incidents")], now).reasons[0]!.code).toBe(
      "NO_SERIOUS_INCIDENT",
    );
  });
  it("échec : notifié trop tard (10 jours en cas de décès, 2 pour une infrastructure critique), ou délai dépassé", () => {
    expect(
      evaluateSeriousIncidentNotified(c, [serious(60, 12, ["incident-death"])], now).reasons[0]!
        .code,
    ).toBe("NOTIFIED_LATE");
    expect(
      evaluateSeriousIncidentNotified(
        c,
        [serious(60, 3, ["incident-critical-infrastructure"])],
        now,
      ).status,
    ).toBe("FAIL");
    expect(evaluateSeriousIncidentNotified(c, [serious(60, 12)], now).status).toBe("PASS");
    expect(evaluateSeriousIncidentNotified(c, [serious(20, null)], now).reasons[0]!.code).toBe(
      "NOT_NOTIFIED",
    );
  });
  it("partiel : incident grave dans son délai, pas encore notifié", () => {
    expect(evaluateSeriousIncidentNotified(c, [serious(5, null)], now)).toMatchObject({
      status: "PARTIAL",
      reasons: [{ code: "NOTIFICATION_PENDING" }],
    });
  });
  it("périmé, absent", () => {
    expect(
      evaluateSeriousIncidentNotified({ ...c, freshnessDays: 7 }, [issue("incidents", {}, 9)], now)
        .status,
    ).toBe("STALE");
    expect(evaluateSeriousIncidentNotified(c, [], now).status).toBe("MISSING");
  });
});

describe("aucun évaluateur Jira n'écrit « conforme »", () => {
  it("raisons françaises", () => {
    const outputs = [
      evaluateRiskRegisterExists(controlOf("AIA-09-01"), [issue("risks")], now),
      evaluateSeriousIncidentNotified(controlOf("AIA-73-01"), [issue("incidents")], now),
    ];
    for (const o of outputs)
      for (const r of o.reasons) expect(r.message.fr).not.toMatch(/conforme/iu);
  });
});
