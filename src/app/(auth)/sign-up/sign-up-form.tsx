"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AFTER_SIGN_IN_PATH, authClient } from "@/lib/auth-client";

export function SignUpForm({ googleEnabled }: { googleEnabled: boolean }) {
  const t = useTranslations("signUp");
  const tc = useTranslations("common");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    setPending(true);
    setError(false);
    const { error } = await authClient.signUp.email({
      name: String(form.get("name")),
      email,
      password: String(form.get("password")),
      callbackURL: "/verify-email",
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
            authClient.signIn.social({ provider: "google", callbackURL: AFTER_SIGN_IN_PATH })
          }
        >
          {t("withGoogle")}
        </button>
      )}
      <p>
        {t("haveAccount")} <Link href="/sign-in">{t("signIn")}</Link>
      </p>
    </>
  );
}
