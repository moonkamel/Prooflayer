"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("resetPassword");
  const tc = useTranslations("common");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<"idle" | "done" | "invalid">("idle");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    const { error } = await authClient.resetPassword({
      newPassword: String(form.get("password")),
      token,
    });
    setPending(false);
    setStatus(error ? "invalid" : "done");
  }

  if (status === "done") {
    return (
      <>
        <p role="status">{t("done")}</p>
        <Link href="/sign-in">{tc("backToSignIn")}</Link>
      </>
    );
  }

  return (
    <form onSubmit={onSubmit} aria-busy={pending}>
      <label>
        {t("newPassword")}
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </label>
      {status === "invalid" && <p role="alert">{t("invalid")}</p>}
      <button type="submit" disabled={pending}>
        {pending ? tc("loading") : t("submit")}
      </button>
    </form>
  );
}
