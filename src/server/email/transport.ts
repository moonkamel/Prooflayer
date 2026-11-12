// Envoi d'emails transactionnels (§4.2). Le fournisseur réel (Resend, ou Brevo / Scaleway TEM en repli) est branché
// à PL-108, après validation de l'hypothèse sur la région d'envoi en UE.
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
  throw new EmailNotConfiguredError(
    kind
      ? `transport inconnu « ${kind} »`
      : "EMAIL_TRANSPORT absent (seul « outbox » existe avant PL-108)",
  );
}
