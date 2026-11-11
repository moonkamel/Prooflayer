"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  if (sentTo) return <Alert>{t("checkEmail", { email: sentTo })}</Alert>;

  return (
    <>
      <form className="max-w-md space-y-3" onSubmit={onSubmit} aria-busy={pending}>
        <Label>
          {t("name")}
          <Input name="name" autoComplete="name" required />
        </Label>
        {!next && (
          <Label>
            {t("company")}
            <Input name="company" autoComplete="organization" maxLength={120} required />
          </Label>
        )}
        <Label>
          {tc("email")}
          <Input name="email" type="email" autoComplete="email" required />
        </Label>
        <Label>
          {tc("password")}
          <Input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            aria-describedby="password-hint"
          />
        </Label>
        <p id="password-hint">{t("passwordHint")}</p>
        {error && <Alert tone="error">{tc("genericError")}</Alert>}
        <Button type="submit" disabled={pending}>
          {pending ? tc("loading") : t("submit")}
        </Button>
      </form>
      {googleEnabled && (
        <Button
          variant="outline"
          type="button"
          onClick={() =>
            authClient.signIn.social({ provider: "google", callbackURL: next ?? ONBOARDING_PATH })
          }
        >
          {t("withGoogle")}
        </Button>
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
