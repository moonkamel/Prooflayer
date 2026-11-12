// Sentry côté serveur (PL-108) : région UE (DSN de l'organisation hébergée à Francfort), événements nettoyés.
import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-scrub";

export function register() {
  Sentry.init(sentryOptions(process.env.SENTRY_DSN));
}

export const onRequestError = Sentry.captureRequestError;
