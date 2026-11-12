// Classifieur public (PL-208, §7.2 canal 2) : même moteur que l'espace connecté, sans compte. La note PDF est envoyée
// contre une adresse professionnelle ; le consentement à être recontacté est explicite, distinct et facultatif
// (une case non cochée par défaut : la note ne dépend pas de ce consentement, RGPD Art. 7(4)).
// Limites de débit : par adresse et par IP (HMAC, l'adresse IP n'est pas conservée).
import { createHmac } from "node:crypto";
import { z } from "zod";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { CURRENT_RULESET, classify } from "@/server/classify/engine";
import {
  QUESTION_IDS,
  isComplete,
  isValidResponse,
  pathOf,
  pruneResponses,
  toAnswers,
  type Responses,
} from "@/server/classify/questionnaire";
import { createEmailTransport, type EmailTransport } from "@/server/email/transport";
import { countRecentLeads, createLead, leadById } from "@/server/system/public-leads";
import type { Prisma } from "@/generated/prisma/client";
import { renderClassificationNote } from "./classification-note";
import { ServiceError } from "./errors";
import { emailDomain, isProfessionalEmail } from "./professional-email";
import { slugify } from "./system-registry";

export const MAX_NOTES_PER_EMAIL_PER_DAY = 3;
export const MAX_NOTES_PER_IP_PER_HOUR = 10;

export const noteRequestSchema = z
  .object({
    email: z.string().trim().max(254),
    contactConsent: z.boolean(),
    locale: z.enum(["fr", "en"]),
    systemName: z
      .string()
      .trim()
      .max(120)
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    responses: z.record(z.string(), z.unknown()),
  })
  .strict();

export type NoteRequest = z.infer<typeof noteRequestSchema>;

function hashIp(ip: string | null): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  return createHmac("sha256", secret)
    .update(ip ?? "inconnue")
    .digest("hex");
}

/** Réponses reçues du navigateur : seules les réponses valides, sur le chemin, sont retenues. */
function cleanResponses(raw: Record<string, unknown>): Responses {
  const responses: Responses = {};
  for (const id of QUESTION_IDS) {
    if (raw[id] !== undefined && isValidResponse(id, raw[id])) responses[id] = raw[id];
  }
  return pruneResponses(responses);
}

/**
 * Enregistre une demande de note et renvoie son identifiant. La classification est recalculée ici : le résultat
 * affiché par le navigateur n'est jamais repris tel quel.
 */
export async function requestNote(input: NoteRequest, context: { ip: string | null; now?: Date }) {
  const now = context.now ?? new Date();
  const email = input.email.toLowerCase();
  if (!isProfessionalEmail(email))
    throw new ServiceError("BAD_REQUEST", "publicClassifier.notProfessional");
  const responses = cleanResponses(input.responses);
  if (!isComplete(responses)) throw new ServiceError("BAD_REQUEST", "publicClassifier.incomplete");

  const ipHash = hashIp(context.ip);
  const [byEmail, byIp] = await Promise.all([
    countRecentLeads({ email }, new Date(now.getTime() - 24 * 3600_000)),
    countRecentLeads({ ipHash }, new Date(now.getTime() - 3600_000)),
  ]);
  if (byEmail >= MAX_NOTES_PER_EMAIL_PER_DAY || byIp >= MAX_NOTES_PER_IP_PER_HOUR) {
    throw new ServiceError("TOO_MANY_REQUESTS", "publicClassifier.tooMany");
  }

  const result = classify(toAnswers(responses), CURRENT_RULESET);
  const messages = input.locale === "en" ? en : fr;
  return createLead({
    email,
    emailDomain: emailDomain(email),
    contactConsent: input.contactConsent,
    consentText: input.contactConsent ? messages.publicClassifier.consent : null,
    consentAt: input.contactConsent ? now : null,
    locale: input.locale,
    systemName: input.systemName ?? null,
    responses: responses as Prisma.InputJsonObject,
    rulesetVersion: CURRENT_RULESET,
    tier: result.tier,
    role: result.role,
    ipHash,
  });
}

/**
 * Envoie la note d'une demande (job `publicClassifier.sendNote`). Idempotent : une demande déjà servie n'est pas
 * renvoyée. L'écriture de `noteSentAt` passe par la transaction du job.
 */
export async function sendLeadNote(
  leadId: string,
  tx: Prisma.TransactionClient,
  transport: EmailTransport = createEmailTransport(),
) {
  const lead = await leadById(leadId, tx);
  if (!lead || lead.noteSentAt) return;
  const locale = lead.locale === "en" ? "en" : "fr";
  const messages = locale === "en" ? en : fr;
  const responses = lead.responses as Responses;
  const result = classify(toAnswers(responses), lead.rulesetVersion);
  const path = pathOf(responses);
  const name = lead.systemName ?? messages.publicClassifier.defaultSystemName;
  const pdf = await renderClassificationNote(
    {
      system: { name, intendedPurpose: messages.publicClassifier.noPurpose, owner: null },
      classification: {
        id: lead.id,
        systemId: "",
        rulesetVersion: lead.rulesetVersion,
        status: "DRAFT",
        responses,
        answered: path.answered,
        current: path.current,
        estimatedLength: path.estimatedLength,
        result: {
          tier: result.tier,
          role: result.role,
          annexIIIPoints: result.annexIIIPoints,
          art63Conditions: result.art63Conditions,
          involvesProfiling: result.involvesProfiling,
          reasoning: result.reasoning,
        },
        signature: null,
      },
    },
    locale,
    new Date(),
  );
  await transport.send({
    to: lead.email,
    subject: messages.publicClassifier.emailSubject.replace("{name}", name),
    text: messages.publicClassifier.emailBody,
    attachments: [
      {
        filename: `note-classification-${slugify(name)}-${locale}.pdf`,
        contentType: "application/pdf",
        contentBase64: pdf.toString("base64"),
      },
    ],
  });
  await tx.publicLead.update({ where: { id: lead.id }, data: { noteSentAt: new Date() } });
}
