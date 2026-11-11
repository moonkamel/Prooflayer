"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { AFTER_SIGN_IN_PATH, authClient } from "@/lib/auth-client";

type Step =
  | { name: "password" }
  | { name: "verify"; qr: string; secret: string; backupCodes: string[] }
  | { name: "backup"; backupCodes: string[] };

export function TwoFactorSetup() {
  const t = useTranslations("twoFactorSetup");
  const tc = useTranslations("common");
  const [step, setStep] = useState<Step>({ name: "password" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({
      password: String(new FormData(event.currentTarget).get("password")),
    });
    // ProofLayer n'utilise que le TOTP (§3.2 E10) ; la méthode « otp » par email n'est pas configurée.
    if (error || !data || data.method !== "totp") {
      setPending(false);
      setError(tc("genericError"));
      return;
    }
    const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
    const qr = await QRCode.toDataURL(data.totpURI, { margin: 1, width: 224 });
    setPending(false);
    setStep({ name: "verify", qr, secret, backupCodes: data.backupCodes });
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step.name !== "verify") return;
    setPending(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({
      code: String(new FormData(event.currentTarget).get("code")).trim(),
    });
    setPending(false);
    if (error) setError(tc("genericError"));
    else setStep({ name: "backup", backupCodes: step.backupCodes });
  }

  if (step.name === "password") {
    return (
      <form onSubmit={start} aria-busy={pending}>
        <p>{t("confirmPassword")}</p>
        <label>
          {tc("password")}
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? tc("loading") : t("start")}
        </button>
      </form>
    );
  }

  if (step.name === "verify") {
    return (
      <form onSubmit={verify} aria-busy={pending}>
        <p>{t("scan")}</p>
        {/* eslint-disable-next-line @next/next/no-img-element -- image générée localement en data: URI */}
        <img src={step.qr} alt="" width={224} height={224} />
        <p>
          {t("secretLabel")} : <code data-testid="totp-secret">{step.secret}</code>
        </p>
        <label>
          {t("enterCode")}
          <input
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? tc("loading") : t("verify")}
        </button>
      </form>
    );
  }

  return (
    <section aria-labelledby="backup-title">
      <p role="status">{t("enabled")}</p>
      <h2 id="backup-title">{t("backupTitle")}</h2>
      <p>{t("backupIntro")}</p>
      <ul data-testid="backup-codes">
        {step.backupCodes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => window.location.assign(AFTER_SIGN_IN_PATH)}>
        {t("backupDone")}
      </button>
    </section>
  );
}
