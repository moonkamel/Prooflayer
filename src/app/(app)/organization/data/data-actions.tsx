"use client";

// Actions de réversibilité (PL-607) : demande d'export, suppression programmée (mot de passe et slug), annulation.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ERRORS = [
  "export.inProgress",
  "deletion.alreadyScheduled",
  "deletion.confirmationMismatch",
  "deletion.activeSubscription",
  "deletion.notScheduled",
  "classification.invalidPassword",
  "classification.tooManyAttempts",
] as const;

function useAction() {
  const t = useTranslations("orgData");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<unknown>, after?: () => void) =>
    start(async () => {
      setError(null);
      try {
        await action();
        after?.();
        router.refresh();
      } catch (e) {
        const reason = e instanceof TRPCClientError ? e.message : "";
        setError(
          (ERRORS as readonly string[]).includes(reason)
            ? t(`errors.${reason.replace(".", "_") as "export_inProgress"}`)
            : t("errors.generic"),
        );
      }
    });
  return { t, pending, error, run };
}

export function ExportButton({ busy }: { busy: boolean }) {
  const { t, pending, error, run } = useAction();
  return (
    <div className="space-y-2">
      <Button
        type="button"
        disabled={pending || busy}
        onClick={() => run(() => trpc.org.export.request.mutate())}
      >
        {busy ? t("export.building") : t("export.request")}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

export function DeletionControls({ scheduled, slug }: { scheduled: boolean; slug: string }) {
  const { t, pending, error, run } = useAction();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  if (scheduled) {
    return (
      <div className="space-y-2">
        <Button
          type="button"
          disabled={pending}
          onClick={() => run(() => trpc.org.deletion.cancel.mutate())}
        >
          {t("deletion.cancel")}
        </Button>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () => trpc.org.deletion.request.mutate({ password, confirmation }),
          () => setPassword(""),
        );
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="deletion-confirmation">{t("deletion.confirmLabel", { slug })}</Label>
        <Input
          id="deletion-confirmation"
          autoComplete="off"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="deletion-password">{t("deletion.passwordLabel")}</Label>
        <Input
          id="deletion-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <Button
        type="submit"
        variant="destructive"
        disabled={pending || confirmation !== slug || !password}
      >
        {t("deletion.request")}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  );
}
