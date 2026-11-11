"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
        <Alert>{t("sent")}</Alert>
        <Link href="/sign-in">{tc("backToSignIn")}</Link>
      </>
    );
  }

  return (
    <form className="max-w-md space-y-3" onSubmit={onSubmit} aria-busy={pending}>
      <p>{t("intro")}</p>
      <Label>
        {tc("email")}
        <Input name="email" type="email" autoComplete="email" required />
      </Label>
      {error && <Alert tone="error">{tc("genericError")}</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? tc("loading") : t("submit")}
      </Button>
    </form>
  );
}
