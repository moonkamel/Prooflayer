import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderAuthEmail, sendAuthEmail } from "@/server/email/auth-emails";
import {
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
