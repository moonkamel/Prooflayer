"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const t = useTranslations("forgotPassword");
  const tc = useTranslations("common");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(false);
    const { error } = await authClient.requestPasswordReset({
      email: String(form.get("email")),
      redirectTo: "/reset-password",
    });
    setPending(false);
    // Même message qu'un compte existe ou non : pas d'énumération des adresses.
    if (error) setError(true);
    else setSent(true);
  }

  if (sent) {
    return (
      <>
        <p role="status">{t("sent")}</p>
        <Link href="/sign-in">{tc("backToSignIn")}</Link>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} aria-busy={pending}>
      <p>{t("intro")}</p>
      <label>
        {tc("email")}
        <input name="email" type="email" autoComplete="email" required />
      </label>
      {error && <p role="alert">{tc("genericError")}</p>}
      <button type="submit" disabled={pending}>
        {pending ? tc("loading") : t("submit")}
      </button>
    </form>
  );
}
