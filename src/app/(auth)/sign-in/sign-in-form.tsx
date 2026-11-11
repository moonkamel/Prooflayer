"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AFTER_SIGN_IN_PATH, authClient, TWO_FACTOR_CHALLENGE_PATH } from "@/lib/auth-client";

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
      <form onSubmit={onSubmit} aria-busy={pending}>
        <label>
          {tc("email")}
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          {tc("password")}
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p role="alert">{error === "generic" ? tc("genericError") : t(error)}</p>}
        <button type="submit" disabled={pending}>
          {pending ? tc("loading") : t("submit")}
        </button>
      </form>
      {googleEnabled && (
        <button
          type="button"
          onClick={() =>
            authClient.signIn.social({
              provider: "google",
              callbackURL: next ?? AFTER_SIGN_IN_PATH,
            })
          }
        >
          {t("withGoogle")}
        </button>
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
