"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AFTER_SIGN_IN_PATH, authClient, TWO_FACTOR_CHALLENGE_PATH } from "@/lib/auth-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SignInError = "invalidCredentials" | "emailNotVerified" | "generic";

export function SignInForm({
  googleEnabled,
  next,
}: {
  googleEnabled: boolean;
  next: string | null;
}) {
  const t = useTranslations("signIn");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SignInError | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
      callbackURL: next ?? AFTER_SIGN_IN_PATH,
    });
    setPending(false);
    if (error) {
      setError(
        error.status === 403
          ? "emailNotVerified"
          : error.status === 401
            ? "invalidCredentials"
            : "generic",
      );
      return;
    }
    // 2FA active : la connexion se poursuit sur l'écran du second facteur.
    const twoFactor = Boolean(data && "twoFactorRedirect" in data && data.twoFactorRedirect);
    router.push(
      twoFactor
        ? `${TWO_FACTOR_CHALLENGE_PATH}${next ? `?next=${encodeURIComponent(next)}` : ""}`
        : (next ?? AFTER_SIGN_IN_PATH),
    );
    router.refresh();
  }

  return (
    <>
      <form className="max-w-md space-y-3" onSubmit={onSubmit} aria-busy={pending}>
        <Label>
          {tc("email")}
          <Input name="email" type="email" autoComplete="email" required />
        </Label>
        <Label>
          {tc("password")}
          <Input name="password" type="password" autoComplete="current-password" required />
        </Label>
        {error && <Alert tone="error">{error === "generic" ? tc("genericError") : t(error)}</Alert>}
        <Button type="submit" disabled={pending}>
          {pending ? tc("loading") : t("submit")}
        </Button>
      </form>
      {googleEnabled && (
        <Button
          variant="outline"
          type="button"
          onClick={() =>
            authClient.signIn.social({
              provider: "google",
              callbackURL: next ?? AFTER_SIGN_IN_PATH,
            })
          }
        >
          {t("withGoogle")}
        </Button>
      )}
      <p>
        <Link href="/forgot-password">{t("forgotPassword")}</Link>
      </p>
      <p>
        {t("noAccount")}{" "}
        <Link href={next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up"}>
          {t("signUp")}
        </Link>
      </p>
    </>
  );
}
