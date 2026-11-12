// PL-404 — Normaliseurs Jira (liste blanche, historique des statuts, déduplication) et authentification des webhooks.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ISSUE_SNAPSHOT,
  ISSUE_TRANSITIONED,
  normalizeIssue,
  normalizeRemoval,
} from "@/server/connectors/jira/normalizers";
import { verifyJiraWebhookJwt } from "@/server/connectors/jira/webhook-auth";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(join(__dirname, "..", "fixtures", "jira", "issue", `${name}.json`), "utf8"),
  );
const capturedAt = new Date("2026-11-12T10:00:00Z");
const ctx = {
  resourceId: "res_map_risks",
  purpose: "risks" as const,
  capturedAt,
  capturedVia: "WEBHOOK" as const,
  siteUrl: "https://talvio.atlassian.net",
};

describe("jira.issue.snapshot et jira.issue.transitioned", () => {
  it("liste blanche : ni description, ni commentaire, ni nom ni email de personne", () => {
    for (const name of ["risk-1", "incident-1", "review-1"]) {
      const json = JSON.stringify(normalizeIssue(fixture(name), ctx));
      for (const forbidden of [
        "confidentiel",
        "commentaire privé",
        "Clara Martin",
        "clara@talvio.example",
        "jean.dupont@example.com",
        "ancien texte",
        "Responsable risques",
      ]) {
        expect(json, `${name} : ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("instantané : état du ticket, liens, historique des statuts, lien vers le site", () => {
    const [snapshot, ...transitions] = normalizeIssue(fixture("risk-1"), ctx);
    expect(snapshot).toMatchObject({
      kind: ISSUE_SNAPSHOT,
      source: "JIRA",
      resourceId: "res_map_risks",
      sourceRef: "jira:10101",
      sourceUrl: "https://talvio.atlassian.net/browse/AIR-12",
      occurredAt: capturedAt,
      actor: { login: "5f0000000000000000000001" },
    });
    expect(snapshot!.payload).toEqual({
      issueId: "10101",
      key: "AIR-12",
      project: "AIR",
      purpose: "risks",
      inMapping: true,
      title: "Biais de genre dans le score d'adéquation",
      issueType: "Risk",
      status: "En cours",
      statusCategory: "indeterminate",
      priority: "High",
      labels: ["ai-risk", "fairness"],
      assigneeAccountId: "5f0000000000000000000001",
      resolution: null,
      resolutionDate: null,
      created: "2026-08-01T07:00:00.000Z",
      updated: "2026-11-05T13:30:00.000Z",
      links: [
        { type: "Relates", direction: "outward", key: "AIR-14" },
        { type: "Blocks", direction: "inward", key: "ENG-301" },
      ],
      statusHistory: [{ at: "2026-08-02T08:00:00.000Z", from: "À faire", to: "En cours" }],
      capturedAt: "2026-11-12T10:00:00.000Z",
    });
    // Seuls les changements de statut deviennent des transitions.
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      kind: ISSUE_TRANSITIONED,
      dedupeKey: "jira:tr:res_map_risks:10101:20001",
      occurredAt: new Date("2026-08-02T08:00:00.000Z"),
      payload: {
        key: "AIR-12",
        from: "À faire",
        to: "En cours",
        authorAccountId: "5f0000000000000000000001",
      },
    });
  });

  it("acceptation du risque résiduel : lue seulement dans le champ configuré, réduite à l'identifiant du compte", () => {
    const [withField] = normalizeIssue(fixture("risk-1"), {
      ...ctx,
      acceptanceField: "customfield_10050",
    });
    expect((withField!.payload as Record<string, unknown>).acceptedByAccountId).toBe(
      "5f0000000000000000000003",
    );
    const [without] = normalizeIssue(fixture("risk-1"), ctx);
    expect(without!.payload).not.toHaveProperty("acceptedByAccountId");
    const [absent] = normalizeIssue(fixture("incident-1"), {
      ...ctx,
      acceptanceField: "customfield_10050",
    });
    expect((absent!.payload as Record<string, unknown>).acceptedByAccountId).toBeNull();
  });

  it("déduplication : même état le même jour → même clé ; état changé ou autre jour → autre clé", () => {
    const key = (issue: unknown, at = capturedAt) =>
      normalizeIssue(issue, { ...ctx, capturedAt: at })[0]!.dedupeKey;
    const issue = fixture("incident-1");
    expect(key(issue)).toBe(key(issue, new Date("2026-11-12T23:00:00Z")));
    expect(key(issue)).not.toBe(key(issue, new Date("2026-11-13T01:00:00Z")));
    const changed = {
      ...issue,
      fields: { ...issue.fields, status: { name: "Rouvert", statusCategory: { key: "new" } } },
    };
    expect(key(changed)).not.toBe(key(issue));
    expect(normalizeIssue(issue, ctx).filter((e) => e.kind === ISSUE_TRANSITIONED)).toHaveLength(3);
  });

  it("charge invalide : aucune preuve, avertissement sans la charge", () => {
    const warnings: string[] = [];
    expect(
      normalizeIssue(
        { id: "1", key: "pas une clé", fields: {} },
        { ...ctx, warn: (m) => warnings.push(m) },
      ),
    ).toEqual([]);
    expect(warnings[0]).toMatch(/^normaliseur jira\.issue\.snapshot : charge invalide/u);
    expect(warnings[0]).not.toContain("pas une clé");
  });

  it("sortie de correspondance : instantané inMapping=false, un par jour", () => {
    const out = normalizeRemoval({ issueId: "10101", key: "AIR-12" }, ctx);
    expect(out).toMatchObject({
      kind: ISSUE_SNAPSHOT,
      dedupeKey: "jira:snap:res_map_risks:10101:2026-11-12:out",
      payload: { key: "AIR-12", inMapping: false, purpose: "risks" },
    });
  });
});

describe("authentification des webhooks (hypothèse du §4.5.2 : JWT HS256 signé avec le secret client)", () => {
  const secret = "secret-client";
  const jwt = (claims: object, key = secret, alg = "HS256") => {
    const h = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
    const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const s = createHmac("sha256", key).update(`${h}.${p}`).digest("base64url");
    return `${h}.${p}.${s}`;
  };
  const now = new Date("2026-11-12T10:00:00Z");
  const exp = Math.floor(now.getTime() / 1000) + 60;

  it("jeton valide, en-tête « JWT » ou « Bearer »", () => {
    expect(verifyJiraWebhookJwt(`JWT ${jwt({ exp })}`, secret, now)).toMatchObject({ exp });
    expect(verifyJiraWebhookJwt(`Bearer ${jwt({ exp })}`, secret, now)).not.toBeNull();
  });

  it("refus : autre secret, expiré, autre algorithme, altéré, absent", () => {
    expect(verifyJiraWebhookJwt(`JWT ${jwt({ exp }, "autre")}`, secret, now)).toBeNull();
    expect(verifyJiraWebhookJwt(`JWT ${jwt({ exp: exp - 120 })}`, secret, now)).toBeNull();
    expect(verifyJiraWebhookJwt(`JWT ${jwt({ exp }, secret, "none")}`, secret, now)).toBeNull();
    expect(verifyJiraWebhookJwt(`JWT ${jwt({ exp })}x`, secret, now)).toBeNull();
    expect(verifyJiraWebhookJwt(null, secret, now)).toBeNull();
    expect(verifyJiraWebhookJwt("JWT a.b", secret, now)).toBeNull();
  });
});
