import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderAuthEmail, sendAuthEmail } from "@/server/email/auth-emails";
import {
  BrevoTransport,
  createEmailTransport,
  EmailNotConfiguredError,
  OutboxTransport,
} from "@/server/email/transport";

const URL_FIXTURE = "https://app.example/api/auth/verify-email?token=abc";

describe("createEmailTransport", () => {
  it("refuse de fonctionner sans transport configuré", () => {
    expect(() => createEmailTransport({})).toThrow(EmailNotConfiguredError);
  });

  it("refuse un transport inconnu", () => {
    expect(() => createEmailTransport({ EMAIL_TRANSPORT: "smtp" })).toThrow(
      EmailNotConfiguredError,
    );
  });

  it("refuse le transport outbox en production Vercel", () => {
    expect(() =>
      createEmailTransport({ EMAIL_TRANSPORT: "outbox", VERCEL_ENV: "production" }),
    ).toThrow(EmailNotConfiguredError);
  });

  it("accepte le transport outbox hors production", () => {
    expect(
      createEmailTransport({ EMAIL_TRANSPORT: "outbox", VERCEL_ENV: "preview" }),
    ).toBeInstanceOf(OutboxTransport);
  });
});

describe("emails d'authentification", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pl-outbox-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("rédige l'email de vérification en français par défaut", async () => {
    const msg = await renderAuthEmail(
      "verify",
      { email: "a@b.example", name: "Clara" },
      URL_FIXTURE,
    );
    expect(msg.to).toBe("a@b.example");
    expect(msg.subject).toBe("Vérifiez votre adresse email");
    expect(msg.text).toContain("Bonjour Clara");
    expect(msg.text).toContain(URL_FIXTURE);
  });

  it("rédige l'email de réinitialisation dans la langue de l'utilisateur", async () => {
    const msg = await renderAuthEmail(
      "resetPassword",
      { email: "a@b.example", name: "Clara", locale: "en" },
      URL_FIXTURE,
    );
    expect(msg.subject).toBe("Reset your password");
    expect(msg.text).toContain("Hello Clara");
  });

  it("retombe sur le français pour une langue inconnue", async () => {
    const msg = await renderAuthEmail(
      "verify",
      { email: "a@b.example", name: "C", locale: "de" },
      URL_FIXTURE,
    );
    expect(msg.subject).toBe("Vérifiez votre adresse email");
  });

  it("dépose l'email dans l'outbox, une ligne JSON par envoi", async () => {
    const transport = new OutboxTransport(dir);
    await sendAuthEmail(transport, "verify", { email: "a@b.example", name: "Clara" }, URL_FIXTURE);
    await sendAuthEmail(
      transport,
      "resetPassword",
      { email: "c@d.example", name: "Mehdi" },
      URL_FIXTURE,
    );
    const lines = (await readFile(transport.file, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!) as { to: string; text: string; sentAt: string };
    expect(first.to).toBe("a@b.example");
    expect(first.text).toContain(URL_FIXTURE);
    expect(Number.isNaN(Date.parse(first.sentAt))).toBe(false);
  });
});

describe("BrevoTransport (PL-108)", () => {
  it("exige la clé et l'expéditeur", () => {
    expect(() => createEmailTransport({ EMAIL_TRANSPORT: "brevo" })).toThrow(
      EmailNotConfiguredError,
    );
    expect(
      createEmailTransport({
        EMAIL_TRANSPORT: "brevo",
        BREVO_API_KEY: "k",
        EMAIL_FROM: "no-reply@x.eu",
      }),
    ).toBeInstanceOf(BrevoTransport);
  });

  it("appelle l'API v3 avec la clé en en-tête, le texte et les pièces jointes", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 201 });
    }) as unknown as typeof fetch;
    const transport = new BrevoTransport(
      { apiKey: "cle-test", from: "no-reply@x.eu", fromName: "ProofLayer" },
      fake,
    );
    await transport.send({
      to: "clara@talvio.eu",
      subject: "Note",
      text: "Bonjour",
      attachments: [
        { filename: "note.pdf", contentType: "application/pdf", contentBase64: "JVBERi0=" },
      ],
    });
    expect(calls[0]!.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((calls[0]!.init.headers as Record<string, string>)["api-key"]).toBe("cle-test");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      sender: { email: "no-reply@x.eu", name: "ProofLayer" },
      to: [{ email: "clara@talvio.eu" }],
      subject: "Note",
      textContent: "Bonjour",
      attachment: [{ name: "note.pdf", content: "JVBERi0=" }],
    });
  });

  it("un refus lève une erreur qui ne contient ni la réponse ni le destinataire", async () => {
    const fake = (async () =>
      new Response('{"message":"clara@talvio.eu invalid"}', {
        status: 400,
      })) as unknown as typeof fetch;
    const transport = new BrevoTransport({ apiKey: "k", from: "a@b.eu", fromName: "P" }, fake);
    const error = await transport
      .send({ to: "clara@talvio.eu", subject: "s", text: "t" })
      .catch((e: Error) => e);
    expect((error as Error).message).toBe("Brevo : envoi refusé (HTTP 400)");
  });
});
