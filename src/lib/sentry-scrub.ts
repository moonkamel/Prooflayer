// Nettoyage des événements Sentry (PL-108, §4.2, règle 8 de CLAUDE.md) : ni données personnelles, ni secret, ni charge.
// Sentry ne reçoit que la trace technique : type d'erreur, message, pile, route. Fonction pure.
import type { ErrorEvent } from "@sentry/nextjs";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
const TOKEN = /\b(?:Bearer\s+)?[A-Za-z0-9_\-]{32,}\b/gu;

/** Retire adresses électroniques et chaînes ressemblant à un jeton d'un texte libre. */
export const redactText = (text: string) =>
  text.replace(EMAIL, "[email]").replace(TOKEN, "[jeton]");

export function scrubEvent<E extends ErrorEvent>(event: E): E {
  delete event.user;
  delete event.extra;
  if (event.request) {
    event.request = { method: event.request.method, url: event.request.url?.split("?")[0] };
  }
  if (event.message) event.message = redactText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redactText(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars;
  }
  event.breadcrumbs = (event.breadcrumbs ?? [])
    .filter((b) => b.category !== "console")
    .map((crumb) => {
      const { data, ...rest } = crumb;
      void data;
      return { ...rest, message: rest.message ? redactText(rest.message) : rest.message };
    });
  return event;
}

/** Options communes au serveur et au navigateur. Sans DSN, Sentry reste inactif (développement, tests). */
export const sentryOptions = (dsn: string | undefined) => ({
  dsn,
  enabled: Boolean(dsn),
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend: scrubEvent,
});
