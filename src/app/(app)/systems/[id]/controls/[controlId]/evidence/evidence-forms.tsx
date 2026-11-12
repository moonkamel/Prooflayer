"use client";

// Formulaires de preuve déclarative (PL-405) : dépôt direct d'un fichier vers le stockage par adresse signée, puis
// enregistrement ; attestation signée confirmée par mot de passe.
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  md: "text/markdown",
  csv: "text/csv",
};
const KNOWN_ERRORS = [
  "evidence.unsupportedType",
  "evidence.tooLarge",
  "evidence.contentMismatch",
  "evidence.invalidValidity",
  "evidence.uploadMissing",
  "classification.invalidPassword",
  "classification.tooManyAttempts",
] as const;

function useFormState() {
  const t = useTranslations("manualEvidence");
  const tc = useTranslations("common");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const fail = (error: unknown) => {
    const reason = error instanceof TRPCClientError ? error.message : "";
    setMessage({
      tone: "error",
      text: (KNOWN_ERRORS as readonly string[]).includes(reason)
        ? t(`errors.${reason.replace(".", "_") as "evidence_tooLarge"}`)
        : tc("genericError"),
    });
  };
  return { t, pending, start, message, setMessage, fail };
}

export function UploadForm({
  controlInstanceId,
  backHref,
}: {
  controlInstanceId: string;
  backHref: string;
}) {
  const { t, pending, start, message, setMessage, fail } = useFormState();
  const router = useRouter();
  const fileId = useId();
  const titleId = useId();
  const dateId = useId();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    const contentType = MIME_BY_EXTENSION[ext] ?? file.type;
    start(async () => {
      setMessage(null);
      try {
        const { uploadUrl, token } = await trpc.evidence.createUploadUrl.mutate({
          controlInstanceIds: [controlInstanceId],
          filename: file.name,
          contentType,
          size: file.size,
        });
        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "content-type": contentType },
          body: file,
        });
        if (!put.ok) throw new Error("upload");
        await trpc.evidence.registerUpload.mutate({
          token,
          validUntil: String(form.get("validUntil")),
          title: String(form.get("title") ?? "") || null,
        });
        setMessage({ tone: "info", text: t("uploaded") });
        router.push(backHref);
        router.refresh();
      } catch (error) {
        fail(error);
      }
    });
  };
  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-md border border-border p-3"
      data-testid="upload-form"
    >
      <h3>{t("uploadTitle")}</h3>
      <p className="text-sm text-muted-foreground">{t("uploadHelp")}</p>
      <div>
        <Label htmlFor={fileId}>{t("file")}</Label>
        <Input
          id={fileId}
          name="file"
          type="file"
          accept=".pdf,.docx,.png,.jpg,.jpeg,.md,.csv"
          required
        />
      </div>
      <div>
        <Label htmlFor={titleId}>{t("documentTitle")}</Label>
        <Input id={titleId} name="title" maxLength={200} />
      </div>
      <div>
        <Label htmlFor={dateId}>{t("validUntil")}</Label>
        <Input id={dateId} name="validUntil" type="date" required />
      </div>
      <Button type="submit" disabled={pending}>
        {t("upload")}
      </Button>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </form>
  );
}

export function AttestForm({
  controlInstanceId,
  backHref,
}: {
  controlInstanceId: string;
  backHref: string;
}) {
  const { t, pending, start, message, setMessage, fail } = useFormState();
  const router = useRouter();
  const ids = {
    statement: useId(),
    name: useId(),
    title: useId(),
    date: useId(),
    password: useId(),
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    start(async () => {
      setMessage(null);
      try {
        await trpc.evidence.attest.mutate({
          controlInstanceIds: [controlInstanceId],
          statement: String(form.get("statement")),
          name: String(form.get("name")),
          title: String(form.get("title")),
          validUntil: String(form.get("validUntil")),
          password: String(form.get("password")),
        });
        setMessage({ tone: "info", text: t("attested") });
        router.push(backHref);
        router.refresh();
      } catch (error) {
        fail(error);
      }
    });
  };
  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-md border border-border p-3"
      data-testid="attest-form"
    >
      <h3>{t("attestTitle")}</h3>
      <p className="text-sm text-muted-foreground">{t("attestHelp")}</p>
      <div>
        <Label htmlFor={ids.statement}>{t("statement")}</Label>
        <textarea
          id={ids.statement}
          name="statement"
          required
          minLength={10}
          maxLength={4000}
          rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div>
        <Label htmlFor={ids.name}>{t("signerName")}</Label>
        <Input id={ids.name} name="name" required maxLength={120} autoComplete="name" />
      </div>
      <div>
        <Label htmlFor={ids.title}>{t("signerTitle")}</Label>
        <Input
          id={ids.title}
          name="title"
          required
          maxLength={120}
          autoComplete="organization-title"
        />
      </div>
      <div>
        <Label htmlFor={ids.date}>{t("validUntil")}</Label>
        <Input id={ids.date} name="validUntil" type="date" required />
      </div>
      <div>
        <Label htmlFor={ids.password}>{t("password")}</Label>
        <Input
          id={ids.password}
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {t("attest")}
      </Button>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </form>
  );
}
