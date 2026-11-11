// Lecture de la boîte d'envoi locale (transport « outbox ») : retrouve le dernier email d'un destinataire.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { E2E_OUTBOX_DIR } from "./env";

interface OutboxEmail {
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}

async function readOutbox(): Promise<OutboxEmail[]> {
  try {
    const raw = await readFile(join(E2E_OUTBOX_DIR, "outbox.jsonl"), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as OutboxEmail);
  } catch {
    return [];
  }
}

/** Attend un email pour `to` dont le sujet contient `subject`, envoyé après `since`, et renvoie son premier lien. */
export async function waitForEmailLink(to: string, subject: string, since: Date): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const email = (await readOutbox())
          .filter((e) => e.to === to && e.subject.includes(subject) && new Date(e.sentAt) >= since)
          .at(-1);
        link = email?.text.match(/https?:\/\/\S+/u)?.[0];
        return link;
      },
      { timeout: 15_000, message: `email « ${subject} » pour ${to}` },
    )
    .toBeTruthy();
  return link!;
}
