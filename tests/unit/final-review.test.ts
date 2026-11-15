// Revue finale (2/2) — archives chiffrées au repos, jeton de webhook Jira sans échéance refusé, secret de hachage
// des IP sans valeur de repli en production, tâches de ménage programmées une fois par jour.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyJiraWebhookJwt } from "@/server/connectors/jira/webhook-auth";
import { generateKey } from "@/server/crypto/envelope";
import { exportAad, openArchive, packAad, sealArchive } from "@/server/storage/sealed";
import { rateSecret } from "@/server/system/rate-limit";

describe("archives au repos", () => {
  const dek = generateKey();
  const zip = Buffer.from("PK\u0003\u0004 contenu");

  it("chiffrée, liée à son pack ; ouverte avec la clé de l'organisation", async () => {
    const sealed = sealArchive(dek, zip, packAad("org_1", "pck_1"));
    expect(sealed[0]).toBe(0x01);
    expect(sealed.includes(Buffer.from("contenu"))).toBe(false);
    expect(await openArchive(sealed, packAad("org_1", "pck_1"), async () => dek)).toEqual(zip);
    await expect(openArchive(sealed, packAad("org_1", "pck_2"), async () => dek)).rejects.toThrow();
    await expect(
      openArchive(sealed, exportAad("org_1", "pck_1"), async () => dek),
    ).rejects.toThrow();
    await expect(
      openArchive(sealed, packAad("org_1", "pck_1"), async () => generateKey()),
    ).rejects.toThrow();
  });

  it("archive antérieure, en clair : lue telle quelle, sans demander la clé", async () => {
    const opened = await openArchive(zip, packAad("org_1", "pck_1"), async () => {
      throw new Error("clé demandée à tort");
    });
    expect(opened).toEqual(zip);
  });
});

describe("webhook Jira", () => {
  const secret = "secret-client";
  const jwt = (claims: object) => {
    const h = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `JWT ${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
  };
  const now = new Date("2026-11-15T12:00:00Z");
  const seconds = Math.floor(now.getTime() / 1000);

  it("échéance exigée : sans `exp`, ou expiré, le jeton est refusé", () => {
    expect(verifyJiraWebhookJwt(jwt({ exp: seconds + 60 }), secret, now)).not.toBeNull();
    expect(verifyJiraWebhookJwt(jwt({ iss: "jira" }), secret, now)).toBeNull();
    expect(verifyJiraWebhookJwt(jwt({ exp: seconds - 1 }), secret, now)).toBeNull();
    expect(verifyJiraWebhookJwt(jwt({ exp: "demain" }), secret, now)).toBeNull();
  });
});

describe("secret de hachage des adresses IP", () => {
  it("jamais de valeur de repli en production", () => {
    expect(rateSecret({ BETTER_AUTH_SECRET: "s" })).toBe("s");
    expect(rateSecret({})).toBe("prooflayer-dev-secret");
    expect(() => rateSecret({ VERCEL_ENV: "production" })).toThrow("BETTER_AUTH_SECRET absent");
  });
});
