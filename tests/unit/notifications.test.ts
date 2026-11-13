// PL-408 — Alertes, fonctions pures : régression PASS → FAIL, résumé quotidien selon le rôle (vide : aucun email),
// échéance du résumé, rendu des emails dans la langue du destinataire (jamais « conforme »).
import { describe, expect, it } from "vitest";
import { renderControlFailedEmail, renderDigestEmail } from "@/server/email/notification-emails";
import {
  DIGEST_MAX_LINES,
  digestDay,
  digestForUser,
  digestRunAt,
  expiryWindow,
  isRegression,
  type DigestFacts,
} from "@/server/services/notifications-data";

const now = new Date("2026-11-13T02:17:00Z");
const DAY = 86_400_000;

describe("régression", () => {
  it("seul le passage de PASS à FAIL déclenche l'email immédiat", () => {
    expect(isRegression("PASS", "FAIL")).toBe(true);
    for (const [a, b] of [
      ["PARTIAL", "FAIL"],
      ["MISSING", "FAIL"],
      ["FAIL", "FAIL"],
      ["PASS", "STALE"],
      ["PASS", "PARTIAL"],
      ["PASS", "PASS"],
    ] as const) {
      expect(isRegression(a, b), `${a} → ${b}`).toBe(false);
    }
  });
});

describe("résumé quotidien", () => {
  const facts: DigestFacts = {
    expiring: [
      {
        controlInstanceId: "cin_1",
        controlKey: "AIA-05-01",
        controlOwnerId: "usr_c",
        systemId: "sys_1",
        systemName: "Score",
        systemOwnerId: "usr_a",
        evidenceSummary: "Attestation annuelle",
        validUntil: new Date(now.getTime() + 10 * DAY),
      },
      {
        controlInstanceId: "cin_2",
        controlKey: "AIA-47-01",
        controlOwnerId: null,
        systemId: "sys_2",
        systemName: "Tri",
        systemOwnerId: "usr_a",
        evidenceSummary: "Déclaration UE",
        validUntil: new Date(now.getTime() + 3 * DAY),
      },
    ],
    integrations: [
      { provider: "JIRA", status: "REVOKED" },
      { provider: "GITHUB", status: "ACTIVE" },
    ],
    staleClassifications: [{ systemId: "sys_2", systemName: "Tri", systemOwnerId: "usr_a" }],
  };

  it("owner et admin : tout, les preuves qui expirent le plus tôt d'abord ; seuls les connecteurs en erreur", () => {
    const digest = digestForUser(facts, "usr_x", "admin")!;
    expect(digest.expiring.map((e) => e.controlKey)).toEqual(["AIA-47-01", "AIA-05-01"]);
    expect(digest.integrations).toEqual([{ provider: "JIRA", status: "REVOKED" }]);
    expect(digest.staleClassifications).toHaveLength(1);
  });

  it("contributeur ou auditeur : seulement ce dont il est responsable, jamais les connecteurs", () => {
    const c = digestForUser(facts, "usr_c", "contributor")!;
    expect(c.expiring.map((e) => e.controlKey)).toEqual(["AIA-05-01"]);
    expect(c.integrations).toEqual([]);
    expect(c.staleClassifications).toEqual([]);
    const owner = digestForUser(facts, "usr_a", "auditor")!;
    expect(owner.expiring).toHaveLength(2);
    expect(owner.staleClassifications).toHaveLength(1);
  });

  it("rien à signaler : aucun résumé", () => {
    expect(digestForUser(facts, "usr_inconnu", "contributor")).toBeNull();
    expect(
      digestForUser({ expiring: [], integrations: [], staleClassifications: [] }, "u", "owner"),
    ).toBeNull();
  });

  it("jour et heure d'envoi (UTC), fenêtre de 14 jours", () => {
    expect(digestDay(now)).toBe("2026-11-13");
    expect(digestRunAt("2026-11-13").toISOString()).toBe("2026-11-13T05:47:00.000Z");
    const { from, to } = expiryWindow(now);
    expect((to.getTime() - from.getTime()) / DAY).toBe(14);
  });
});

describe("emails", () => {
  it("régression : sujet, raisons (5 au plus), lien vers le contrôle et vers les préférences", async () => {
    const message = await renderControlFailedEmail({
      to: "clara@example.test",
      name: "Clara",
      locale: "fr",
      baseUrl: "https://app.example.test",
      organization: "Talvio",
      system: { id: "sys_1", name: "Score" },
      control: {
        id: "cin_1",
        key: "AIA-15-02",
        title: { fr: "PR approuvées par un tiers", en: "PRs approved by another person" },
      },
      reasons: Array.from({ length: 7 }, (_, i) => ({
        fr: `PR #${i} sans approbation`,
        en: `PR #${i}`,
      })),
    });
    expect(message.subject).toBe("[ProofLayer] AIA-15-02 en échec · Score");
    expect(message.text).toContain("PR #4 sans approbation");
    expect(message.text).not.toContain("PR #5 sans approbation");
    expect(message.text).toContain("et 2 autres raisons");
    expect(message.text).toContain("https://app.example.test/systems/sys_1/controls/cin_1");
    expect(message.text).toContain("https://app.example.test/notifications");
    expect(message.text).not.toMatch(/conforme/iu);
  });

  it("résumé : une rubrique par sujet et par organisation, en anglais si l'utilisateur l'a choisi, plafonné", async () => {
    const expiring = Array.from({ length: DIGEST_MAX_LINES + 3 }, (_, i) => ({
      controlInstanceId: `cin_${i}`,
      controlKey: `AIA-05-0${i}`,
      systemId: "sys_1",
      systemName: "Score",
      evidenceSummary: "Attestation",
      validUntil: "2026-11-20T00:00:00.000Z",
    }));
    const message = await renderDigestEmail({
      to: "sam@example.test",
      name: "Sam",
      locale: "en",
      baseUrl: "https://app.example.test",
      organizations: [
        {
          name: "Talvio",
          digest: {
            expiring,
            integrations: [{ provider: "JIRA", status: "REVOKED" }],
            staleClassifications: [{ systemId: "sys_2", systemName: "Tri" }],
          },
        },
      ],
    });
    expect(message.subject).toBe("[ProofLayer] Daily summary");
    expect(message.text).toContain("## Talvio");
    expect(message.text).toContain("23 items of evidence expire within 14 days");
    expect(message.text).toContain("valid until 20 November 2026");
    expect(message.text).toContain("… and 3 more");
    expect(message.text).toContain("JIRA: revoked");
    expect(message.text).toContain("https://app.example.test/systems/sys_2/classification");
  });
});
