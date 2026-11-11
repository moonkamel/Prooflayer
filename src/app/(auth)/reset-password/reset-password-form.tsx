"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
        <Alert>{t("done")}</Alert>
        <Link href="/sign-in">{tc("backToSignIn")}</Link>
      </>
    );
  }

  return (
    <form className="max-w-md space-y-3" onSubmit={onSubmit} aria-busy={pending}>
      <Label>
        {t("newPassword")}
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </Label>
      {status === "invalid" && <Alert tone="error">{t("invalid")}</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? tc("loading") : t("submit")}
      </Button>
    </form>
  );
}
