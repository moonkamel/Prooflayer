// Envoi d'emails transactionnels (§4.2). Fournisseur retenu à PL-108 : Brevo (repli prévu par le §4.2, choisi pour
// l'envoi depuis l'UE), par son API HTTP (`BREVO_API_KEY`, expéditeur `EMAIL_FROM`).
//
// Transport « outbox » : écrit chaque email dans un fichier JSON Lines local, lu par les tests et en développement.
// Il contient des liens à jeton : c'est une boîte de réception de développement, pas un journal, et il est refusé
// en production Vercel.
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface EmailAttachment {
  filename: string;
  contentType: string;
  /** Contenu encodé en base64. */
  contentBase64: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  attachments?: EmailAttachment[];
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

export class OutboxTransport implements EmailTransport {
  constructor(private readonly dir: string) {}

  get file(): string {
    return join(this.dir, "outbox.jsonl");
  }

  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const line = JSON.stringify({ ...message, sentAt: new Date().toISOString() });
    await appendFile(this.file, line + "\n", "utf8");
  }
}

/** Brevo (API transactionnelle v3). Le message d'erreur ne reprend jamais le corps de la réponse ni le destinataire. */
export class BrevoTransport implements EmailTransport {
  constructor(
    private readonly options: { apiKey: string; from: string; fromName: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchImpl("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": this.options.apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: this.options.from, name: this.options.fromName },
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        ...(message.attachments?.length
          ? {
              attachment: message.attachments.map((a) => ({
                name: a.filename,
                content: a.contentBase64,
              })),
            }
          : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Brevo : envoi refusé (HTTP ${response.status})`);
  }
}

export class EmailNotConfiguredError extends Error {
  constructor(detail: string) {
    super(`Envoi d'email non configuré : ${detail}`);
    this.name = "EmailNotConfiguredError";
  }
}

type Env = Record<string, string | undefined>;

export function createEmailTransport(env: Env = process.env): EmailTransport {
  const kind = env.EMAIL_TRANSPORT;
  if (kind === "outbox") {
    if (env.VERCEL_ENV === "production") {
      throw new EmailNotConfiguredError("le transport outbox est interdit en production");
    }
    return new OutboxTransport(env.EMAIL_OUTBOX_DIR ?? ".outbox");
  }
  if (kind === "brevo") {
    if (!env.BREVO_API_KEY || !env.EMAIL_FROM) {
      throw new EmailNotConfiguredError("BREVO_API_KEY et EMAIL_FROM requis");
    }
    return new BrevoTransport({
      apiKey: env.BREVO_API_KEY,
      from: env.EMAIL_FROM,
      fromName: env.EMAIL_FROM_NAME ?? "ProofLayer",
    });
  }
  throw new EmailNotConfiguredError(
    kind ? `transport inconnu « ${kind} »` : "EMAIL_TRANSPORT absent (« outbox » ou « brevo »)",
  );
}
