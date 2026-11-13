"use client";

// Préférences d'envoi et lecture des alertes (PL-408). Après chaque écriture, la page serveur est relue.
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Preferences = { controlFailedEmail: boolean; dailyDigestEmail: boolean };

export function PreferencesForm({ initial }: { initial: Preferences }) {
  const t = useTranslations("notifications");
  const tc = useTranslations("common");
  const router = useRouter();
  const failedId = useId();
  const digestId = useId();
  const [prefs, setPrefs] = useState(initial);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    start(async () => {
      setMessage(null);
      try {
        await trpc.notification.preferences.set.mutate(prefs);
        setMessage({ tone: "info", text: t("saved") });
        router.refresh();
      } catch {
        setMessage({ tone: "error", text: tc("genericError") });
      }
    });
  };
  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-md border border-border p-4"
      data-testid="preferences"
    >
      <div className="flex items-start gap-2">
        <input
          id={failedId}
          type="checkbox"
          className="mt-1 size-4"
          checked={prefs.controlFailedEmail}
          onChange={(e) => setPrefs({ ...prefs, controlFailedEmail: e.target.checked })}
        />
        <label htmlFor={failedId}>{t("controlFailedEmail")}</label>
      </div>
      <div className="flex items-start gap-2">
        <input
          id={digestId}
          type="checkbox"
          className="mt-1 size-4"
          checked={prefs.dailyDigestEmail}
          onChange={(e) => setPrefs({ ...prefs, dailyDigestEmail: e.target.checked })}
        />
        <label htmlFor={digestId}>{t("dailyDigestEmail")}</label>
      </div>
      <Button type="submit" disabled={pending}>
        {t("save")}
      </Button>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </form>
  );
}

export function MarkAllReadButton({ ids }: { ids: string[] }) {
  const t = useTranslations("notifications");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  return (
    <div>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(false);
            try {
              await trpc.notification.markRead.mutate({ ids: ids.slice(0, 100) });
              router.refresh();
            } catch {
              setError(true);
            }
          })
        }
      >
        {t("markRead")}
      </Button>
      {error && <Alert tone="error">{tc("genericError")}</Alert>}
    </div>
  );
}
