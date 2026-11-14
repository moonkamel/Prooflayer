"use client";

// Actions de l'écran D (PL-407) : responsable du contrôle (contributor), non-applicabilité justifiée (admin),
// commentaire (contributor) ; effacement d'une preuve (admin, PL-507). Après chaque écriture, la page serveur est relue (router.refresh).
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const NA_MIN = 20;
const KNOWN_ERRORS = [
  "control.ownerNotMember",
  "control.justificationRequired",
  "control.naByReclassification",
  "control.commentEmpty",
  "system.archived",
  "evidence.alreadyRedacted",
  "evidence.notFound",
] as const;

function useAction() {
  const t = useTranslations("controlDetail");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const run = (action: () => Promise<unknown>, done: string, after?: () => void) =>
    start(async () => {
      setMessage(null);
      try {
        await action();
        setMessage({ tone: "info", text: done });
        after?.();
        router.refresh();
      } catch (error) {
        const reason = error instanceof TRPCClientError ? error.message : "";
        setMessage({
          tone: "error",
          text: (KNOWN_ERRORS as readonly string[]).includes(reason)
            ? t(`errors.${reason.replace(".", "_") as "control_ownerNotMember"}`)
            : tc("genericError"),
        });
      }
    });
  return { t, pending, message, run };
}

const textareaClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60";

export function OwnerForm({
  controlId,
  ownerUserId,
  members,
  disabled,
}: {
  controlId: string;
  ownerUserId: string | null;
  members: { id: string; name: string }[];
  disabled: boolean;
}) {
  const { t, pending, message, run } = useAction();
  const selectId = useId();
  const [value, setValue] = useState(ownerUserId ?? "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(
      () => trpc.control.assignOwner.mutate({ controlId, ownerUserId: value || null }),
      t("ownerSaved"),
    );
  };
  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-md border border-border p-4"
      data-testid="owner-form"
    >
      <Label htmlFor={selectId}>{t("ownerLabel")}</Label>
      <Select
        id={selectId}
        value={value}
        disabled={disabled || pending}
        onChange={(e) => setValue(e.target.value)}
      >
        <option value="">{t("nobody")}</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
      {!disabled && (
        <Button type="submit" disabled={pending || value === (ownerUserId ?? "")}>
          {t("assign")}
        </Button>
      )}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </form>
  );
}

export function NotApplicableForm({
  controlId,
  notApplicable,
  disabled,
}: {
  controlId: string;
  notApplicable: boolean;
  disabled: boolean;
}) {
  const { t, pending, message, run } = useAction();
  const textId = useId();
  const hintId = useId();
  const [justification, setJustification] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (notApplicable) {
      run(
        () => trpc.control.setNotApplicable.mutate({ controlId, notApplicable: false }),
        t("reopened"),
      );
    } else {
      run(
        () =>
          trpc.control.setNotApplicable.mutate({ controlId, notApplicable: true, justification }),
        t("naSaved"),
        () => setJustification(""),
      );
    }
  };
  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-md border border-border p-4"
      data-testid="na-form"
    >
      <p className="font-medium">{t("naTitle")}</p>
      {disabled ? (
        <p className="text-sm text-muted-foreground">{t("naAdminOnly")}</p>
      ) : notApplicable ? (
        <Button type="submit" variant="outline" disabled={pending}>
          {t("reopen")}
        </Button>
      ) : (
        <>
          <Label htmlFor={textId}>{t("naLabel")}</Label>
          <textarea
            id={textId}
            aria-describedby={hintId}
            className={textareaClass}
            rows={3}
            required
            minLength={NA_MIN}
            maxLength={2000}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
          <p id={hintId} className="text-xs text-muted-foreground">
            {t("naHint", { min: NA_MIN })}
          </p>
          <Button type="submit" disabled={pending || justification.trim().length < NA_MIN}>
            {t("declareNa")}
          </Button>
        </>
      )}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </form>
  );
}

export function CommentForm({ controlId }: { controlId: string }) {
  const { t, pending, message, run } = useAction();
  const textId = useId();
  const [body, setBody] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(
      () => trpc.control.comment.mutate({ controlId, body }),
      t("commentSaved"),
      () => setBody(""),
    );
  };
  return (
    <form onSubmit={submit} className="space-y-2" data-testid="comment-form">
      <Label htmlFor={textId}>{t("commentLabel")}</Label>
      <textarea
        id={textId}
        className={textareaClass}
        rows={3}
        required
        maxLength={2000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <Button type="submit" disabled={pending || body.trim().length === 0}>
        {t("comment")}
      </Button>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </form>
  );
}

const REDACTION_REASONS = ["data_subject_request", "data_minimisation", "other"] as const;

/** Effacement d'une preuve (admin) : motif dans une liste fermée, confirmation explicite, définitif. */
export function RedactEvidenceForm({
  evidenceId,
  summary,
}: {
  evidenceId: string;
  summary: string;
}) {
  const { t, pending, message, run } = useAction();
  const reasonId = useId();
  const confirmId = useId();
  const [reason, setReason] = useState<(typeof REDACTION_REASONS)[number]>("data_subject_request");
  const [confirmed, setConfirmed] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => trpc.evidence.redact.mutate({ evidenceId, reason }), t("redact.done"));
  };
  return (
    <details className="mt-1 text-sm" data-testid="redact-evidence">
      <summary className="cursor-pointer text-destructive underline">
        {t("redact.open")}
        <span className="sr-only"> · {t("redact.forEvidence", { summary })}</span>
      </summary>
      <form onSubmit={submit} className="mt-2 space-y-2 rounded-md border border-border p-3">
        <p className="font-medium">{t("redact.title")}</p>
        <p className="text-muted-foreground">{t("redact.intro")}</p>
        <Label htmlFor={reasonId}>{t("redact.reason")}</Label>
        <Select
          id={reasonId}
          value={reason}
          disabled={pending}
          onChange={(e) => setReason(e.target.value as (typeof REDACTION_REASONS)[number])}
        >
          {REDACTION_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`redact.reasons.${r}`)}
            </option>
          ))}
        </Select>
        <p className="flex items-start gap-2">
          <input
            id={confirmId}
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1"
          />
          <Label htmlFor={confirmId}>{t("redact.confirm")}</Label>
        </p>
        <Button type="submit" variant="destructive" disabled={pending || !confirmed}>
          {t("redact.submit")}
        </Button>
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
      </form>
    </details>
  );
}
