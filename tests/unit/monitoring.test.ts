// PL-609 — Surveillance d'exploitation (pur) : file en retard ou baux expirés, livraisons bloquées, ancre manquée
// (6 h + 2 h), connecteurs en erreur ou révoqués, taux d'échec au-delà de 10 % sur un échantillon suffisant.
import { describe, expect, it } from "vitest";
import { monitorFindings, type MonitorSnapshot } from "@/server/system/monitoring-data";

const now = new Date("2026-11-15T12:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const healthy = (): MonitorSnapshot => ({
  now,
  queue: { oldestDueAt: ago(2), expiredLeases: 0, failedLastHour: 1, doneLastHour: 200 },
  webhooks: { oldestPendingAt: null, failedLastHour: 0, processedLastHour: 50 },
  anchor: { oldestPendingSealedAt: ago(60) },
  integrations: [{ provider: "JIRA", status: "ACTIVE", count: 3 }],
});

describe("constats", () => {
  it("état sain : aucune alerte", () => {
    expect(monitorFindings(healthy())).toEqual([]);
  });

  it("file en retard au-delà de 10 minutes, ou bail expiré", () => {
    expect(
      monitorFindings({ ...healthy(), queue: { ...healthy().queue, oldestDueAt: ago(11) } }),
    ).toEqual([{ code: "ops.queueLagging", details: { lagMinutes: 11, expiredLeases: 0 } }]);
    expect(
      monitorFindings({ ...healthy(), queue: { ...healthy().queue, expiredLeases: 2 } })[0],
    ).toMatchObject({
      code: "ops.queueLagging",
      details: { expiredLeases: 2 },
    });
  });

  it("livraison webhook bloquée ; ancre manquée après 8 heures", () => {
    const s = healthy();
    expect(
      monitorFindings({
        ...s,
        webhooks: { ...s.webhooks, oldestPendingAt: ago(30) },
        anchor: { oldestPendingSealedAt: ago(8 * 60 + 1) },
      }).map((f) => f.code),
    ).toEqual(["ops.webhookLagging", "seal.anchorOverdue"]);
    expect(monitorFindings({ ...s, anchor: { oldestPendingSealedAt: ago(7 * 60) } })).toEqual([]);
  });

  it("connecteurs en erreur ou révoqués, par fournisseur et statut", () => {
    const s = healthy();
    expect(
      monitorFindings({
        ...s,
        integrations: [
          { provider: "JIRA", status: "ERROR", count: 2 },
          { provider: "GITHUB", status: "REVOKED", count: 1 },
          { provider: "GITHUB", status: "SUSPENDED", count: 1 },
        ],
      }),
    ).toEqual([
      { code: "ops.connectorError", details: { provider: "JIRA", status: "ERROR", count: 2 } },
      { code: "ops.connectorError", details: { provider: "GITHUB", status: "REVOKED", count: 1 } },
    ]);
  });

  it("taux d'échec : au-delà de 10 %, seulement à partir de 20 opérations", () => {
    const s = healthy();
    expect(
      monitorFindings({ ...s, queue: { ...s.queue, failedLastHour: 5, doneLastHour: 20 } }),
    ).toEqual([
      { code: "ops.errorRate", details: { source: "jobs", failed: 5, total: 25, rate: 0.2 } },
    ]);
    expect(
      monitorFindings({ ...s, queue: { ...s.queue, failedLastHour: 5, doneLastHour: 5 } }),
    ).toEqual([]);
    expect(
      monitorFindings({
        ...s,
        webhooks: { ...s.webhooks, failedLastHour: 10, processedLastHour: 40 },
      })[0],
    ).toMatchObject({ code: "ops.errorRate", details: { source: "webhooks", rate: 0.2 } });
  });
});
