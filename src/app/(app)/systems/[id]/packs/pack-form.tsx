"use client";

// Formulaire de l'écran E (PL-504) : période, langue, aperçu recalculé à chaque changement, génération (admin).
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Preview = { controls: number; failing: number; missing: number; evidence: number };

export function PackForm({
  systemId,
  defaults,
  initialPreview,
}: {
  systemId: string;
  defaults: { start: string; end: string };
  initialPreview: Preview;
}) {
  const t = useTranslations("packs");
  const tc = useTranslations("common");
  const router = useRouter();
  const startId = useId();
  const endId = useId();
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [language, setLanguage] = useState<"fr" | "en">("fr");
  const [preview, setPreview] = useState<Preview | null>(initialPreview);
  const [pending, run] = useTransition();
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const failure = (error: unknown) => {
    const reason = error instanceof TRPCClientError ? error.message : "";
    return reason === "pack.invalidPeriod" ? t("errors.pack_invalidPeriod") : tc("genericError");
  };
  const refresh = (nextStart: string, nextEnd: string) =>
    run(async () => {
      try {
        setPreview(
          await trpc.pack.preview.query({ systemId, periodStart: nextStart, periodEnd: nextEnd }),
        );
        setMessage(null);
      } catch (error) {
        setPreview(null);
        setMessage({ tone: "error", text: failure(error) });
      }
    });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      try {
        await trpc.pack.create.mutate({ systemId, periodStart: start, periodEnd: end, language });
        setMessage({ tone: "info", text: t("generating") });
        router.refresh();
      } catch (error) {
        setMessage({ tone: "error", text: failure(error) });
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="pack-form">
      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="mb-1 text-sm font-medium">{t("period")}</legend>
        <div>
          <Label htmlFor={startId}>{t("from")}</Label>
          <Input
            id={startId}
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              refresh(e.target.value, end);
            }}
          />
        </div>
        <div>
          <Label htmlFor={endId}>{t("to")}</Label>
          <Input
            id={endId}
            type="date"
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
              refresh(start, e.target.value);
            }}
          />
        </div>
      </fieldset>
      <fieldset className="flex flex-wrap gap-5">
        <legend className="mb-1 text-sm font-medium">{t("language")}</legend>
        {(["fr", "en"] as const).map((l) => (
          <label key={l} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="language"
              value={l}
              checked={language === l}
              onChange={() => setLanguage(l)}
            />
            {t(l)}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1">
        <p className="text-sm font-medium">{t("contents")}</p>
        <p className="text-sm text-muted-foreground">{t("contentsList")}</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t("preview")}</p>
        {preview && (
          <p aria-live="polite" className="text-sm" data-testid="pack-preview">
            {t("previewLine", preview)}
          </p>
        )}
        <Alert>{t("neverHidden")}</Alert>
      </div>
      <Button type="submit" disabled={pending || !preview}>
        {t("generate")}
      </Button>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </form>
  );
}

export function CopyCommandButton({ command }: { command: string }) {
  const t = useTranslations("packs");
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        className="border-slate-500 bg-transparent text-white hover:bg-slate-800"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => setCopied(true));
        }}
      >
        {t("copy")}
      </Button>
      {copied && (
        <span role="status" className="text-sm text-slate-200">
          {t("copied")}
        </span>
      )}
    </div>
  );
}
