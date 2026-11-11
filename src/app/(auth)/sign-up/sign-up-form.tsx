"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";

export const ONBOARDING_PATH = "/onboarding";

/**
 * Sans `next` : inscription d'une nouvelle entreprise (§5.1, écran 1). Le nom de l'entreprise suit le lien de
 * vérification jusqu'à l'écran de création de l'organisation.
 * Avec `next` (lien d'invitation) : aucune organisation n'est créée, l'utilisateur revient à l'invitation.
 */
export function SignUpForm({
  googleEnabled,
  next,
}: {
  googleEnabled: boolean;
  next: string | null;
}) {
  const t = useTranslations("signUp");
  const tc = useTranslations("common");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const company = String(form.get("company") ?? "").trim();
    const after = next ?? `${ONBOARDING_PATH}?name=${encodeURIComponent(company)}`;
    setPending(true);
    setError(false);
    const { error } = await authClient.signUp.email({
      name: String(form.get("name")),
      email,
      password: String(form.get("password")),
      callbackURL: `/verify-email?next=${encodeURIComponent(after)}`,
    });
    setPending(false);
    if (error) setError(true);
    else setSentTo(email);
  }

  if (sentTo) return <p role="status">{t("checkEmail", { email: sentTo })}</p>;

  return (
    <>
      <form onSubmit={onSubmit} aria-busy={pending}>
        <label>
          {t("name")}
          <input name="name" autoComplete="name" required />
        </label>
        {!next && (
          <label>
            {t("company")}
            <input name="company" autoComplete="organization" maxLength={120} required />
          </label>
        )}
        <label>
          {tc("email")}
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          {tc("password")}
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            aria-describedby="password-hint"
          />
        </label>
        <p id="password-hint">{t("passwordHint")}</p>
        {error && <p role="alert">{tc("genericError")}</p>}
        <button type="submit" disabled={pending}>
          {pending ? tc("loading") : t("submit")}
        </button>
      </form>
      {googleEnabled && (
        <button
          type="button"
          onClick={() =>
            authClient.signIn.social({ provider: "google", callbackURL: next ?? ONBOARDING_PATH })
          }
        >
          {t("withGoogle")}
        </button>
      )}
      <p>
        {t("haveAccount")}{" "}
        <Link href={next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"}>
          {t("signIn")}
        </Link>
      </p>
    </>
  );
}
