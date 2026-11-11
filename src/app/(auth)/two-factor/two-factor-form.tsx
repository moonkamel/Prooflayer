"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AFTER_SIGN_IN_PATH, authClient } from "@/lib/auth-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TwoFactorForm({ next }: { next: string | null }) {
  const t = useTranslations("twoFactorChallenge");
  const tc = useTranslations("common");
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code")).trim();
    setPending(true);
    setError(false);
    const { error } =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code })
        : await authClient.twoFactor.verifyBackupCode({ code });
    setPending(false);
    if (error) {
      setError(true);
      return;
    }
    router.push(next ?? AFTER_SIGN_IN_PATH);
    router.refresh();
  }

  return (
    <form className="max-w-md space-y-3" onSubmit={onSubmit} aria-busy={pending}>
      {mode === "totp" && <p>{t("intro")}</p>}
      <Label>
        {mode === "totp" ? t("code") : t("backupCode")}
        <Input
          key={mode}
          name="code"
          autoComplete="one-time-code"
          inputMode={mode === "totp" ? "numeric" : "text"}
          pattern={mode === "totp" ? "[0-9]{6}" : undefined}
          required
        />
      </Label>
      {error && <Alert tone="error">{t("invalidCode")}</Alert>}
      <Button type="submit" disabled={pending}>
        {pending ? tc("loading") : t("submit")}
      </Button>
      <Button
        variant="outline"
        type="button"
        onClick={() => setMode(mode === "totp" ? "backup" : "totp")}
      >
        {mode === "totp" ? t("useBackupCode") : t("useTotp")}
      </Button>
    </form>
  );
}
