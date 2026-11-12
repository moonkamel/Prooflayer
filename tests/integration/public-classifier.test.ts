// PL-208 — Classifieur public sur base réelle : demande de note contre une adresse professionnelle, consentement
// facultatif et explicite, résultat recalculé côté serveur, limites de débit, envoi idempotent avec la note en PDF.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import type { EmailMessage, EmailTransport } from "@/server/email/transport";
import { ServiceError } from "@/server/services/errors";
import {
  MAX_NOTES_PER_EMAIL_PER_DAY,
  requestNote,
  sendLeadNote,
} from "@/server/services/public-classifier";

const run = randomUUID().slice(0, 8);
const domain = `talvio-${run}.example`;
const highRisk = {
  aiSystem: true,
  scope: [],
  prohibited: [],
  annexI: false,
  annexIII: ["4(a)"],
  profiling: true,
  developer: true,
};

async function reasonOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ServiceError);
  return (error as ServiceError).reason;
}

class Capture implements EmailTransport {
  sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
  }
}

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  await client.query(`DELETE FROM "PublicLead" WHERE "emailDomain" = $1`, [domain]);
  await client.end();
  await prisma.$disconnect();
});

describe("classifieur public", () => {
  it("enregistre la demande, recalcule le résultat et envoie la note une seule fois", async () => {
    const lead = await requestNote(
      {
        email: `Clara@${domain}`,
        contactConsent: true,
        locale: "fr",
        systemName: "Score d'adéquation candidat",
        // Une réponse hors chemin envoyée par le navigateur est écartée.
        responses: { ...highRisk, art63: ["a"], transparency: ["inconnu"] },
      },
      { ip: "203.0.113.7" },
    );
    const row = await prisma.publicLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row).toMatchObject({
      email: `clara@${domain}`,
      tier: "HIGH_RISK",
      role: "PROVIDER",
      rulesetVersion: "2026.11.0",
      contactConsent: true,
      consentText: expect.stringContaining("recontacte"),
      noteSentAt: null,
    });
    expect(row.responses).toEqual(highRisk);
    expect(row.ipHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(row.ipHash).not.toContain("203.0.113.7");

    const transport = new Capture();
    await prisma.$transaction((tx) => sendLeadNote(lead.id, tx, transport));
    await prisma.$transaction((tx) => sendLeadNote(lead.id, tx, transport));
    expect(transport.sent).toHaveLength(1);
    const [mail] = transport.sent;
    expect(mail).toMatchObject({
      to: `clara@${domain}`,
      subject: "Note de classification AI Act : Score d'adéquation candidat",
    });
    expect(mail?.attachments?.[0]?.filename).toBe(
      "note-classification-score-d-adequation-candidat-fr.pdf",
    );
    expect(
      Buffer.from(mail!.attachments![0]!.contentBase64, "base64").subarray(0, 5).toString(),
    ).toBe("%PDF-");
    expect(
      (await prisma.publicLead.findUniqueOrThrow({ where: { id: lead.id } })).noteSentAt,
    ).not.toBeNull();
  });

  it("sans consentement : la note est servie, rien n'autorise à recontacter", async () => {
    const lead = await requestNote(
      {
        email: `sans-consentement@${domain}`,
        contactConsent: false,
        locale: "en",
        responses: highRisk,
      },
      { ip: "203.0.113.8" },
    );
    expect(await prisma.publicLead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
      contactConsent: false,
      consentText: null,
      consentAt: null,
      locale: "en",
    });
  });

  it("refuse une messagerie grand public et un questionnaire incomplet", async () => {
    expect(
      await reasonOf(
        requestNote(
          { email: "quelquun@gmail.com", contactConsent: false, locale: "fr", responses: highRisk },
          { ip: "203.0.113.9" },
        ),
      ),
    ).toBe("publicClassifier.notProfessional");
    expect(
      await reasonOf(
        requestNote(
          {
            email: `x@${domain}`,
            contactConsent: false,
            locale: "fr",
            responses: { aiSystem: true },
          },
          { ip: "203.0.113.9" },
        ),
      ),
    ).toBe("publicClassifier.incomplete");
  });

  it("limite les demandes par adresse et par IP", async () => {
    const email = `limite@${domain}`;
    for (let i = 0; i < MAX_NOTES_PER_EMAIL_PER_DAY; i++) {
      await requestNote(
        { email, contactConsent: false, locale: "fr", responses: highRisk },
        { ip: `198.51.100.${i}` },
      );
    }
    expect(
      await reasonOf(
        requestNote(
          { email, contactConsent: false, locale: "fr", responses: highRisk },
          { ip: "198.51.100.99" },
        ),
      ),
    ).toBe("publicClassifier.tooMany");
    const ip = "192.0.2.1";
    for (let i = 0; i < 10; i++) {
      await requestNote(
        { email: `ip${i}@${domain}`, contactConsent: false, locale: "fr", responses: highRisk },
        { ip },
      );
    }
    expect(
      await reasonOf(
        requestNote(
          {
            email: `ip-de-trop@${domain}`,
            contactConsent: false,
            locale: "fr",
            responses: highRisk,
          },
          { ip },
        ),
      ),
    ).toBe("publicClassifier.tooMany");
  });
});
