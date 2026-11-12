// PL-108 — Sentry : aucune donnée personnelle, aucun jeton, aucune charge dans un événement envoyé.
import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { redactText, scrubEvent, sentryOptions } from "@/lib/sentry-scrub";

describe("nettoyage Sentry", () => {
  it("retire utilisateur, en-têtes, cookies, corps, paramètres d'URL et variables locales", () => {
    const event = scrubEvent({
      type: undefined,
      user: { id: "usr_1", email: "clara@talvio.eu", ip_address: "1.2.3.4" },
      extra: { payload: { secret: "x" } },
      request: {
        method: "POST",
        url: "https://app/api/x?token=abc",
        headers: { authorization: "Bearer y" },
        cookies: { session: "z" },
        data: '{"password":"p"}',
      },
      message: "Échec pour clara@talvio.eu avec Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCD",
      exception: {
        values: [
          { value: "invalide : jean@x.fr", stacktrace: { frames: [{ vars: { token: "t" } }] } },
        ],
      },
      breadcrumbs: [
        { category: "console", message: "log" },
        { category: "fetch", message: "POST", data: { body: "charge" } },
      ],
    } as ErrorEvent);
    expect(event.user).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.request).toEqual({ method: "POST", url: "https://app/api/x" });
    expect(event.message).toBe("Échec pour [email] avec [jeton]");
    expect(event.exception!.values![0]!.value).toBe("invalide : [email]");
    expect(event.exception!.values![0]!.stacktrace!.frames![0]!.vars).toBeUndefined();
    expect(event.breadcrumbs).toEqual([{ category: "fetch", message: "POST" }]);
  });

  it("sans DSN, Sentry est inactif ; jamais d'informations personnelles par défaut", () => {
    expect(sentryOptions(undefined)).toMatchObject({ enabled: false, sendDefaultPii: false });
    expect(sentryOptions("https://k@o1.ingest.de.sentry.io/1").enabled).toBe(true);
    expect(redactText("rien à retirer")).toBe("rien à retirer");
  });
});
