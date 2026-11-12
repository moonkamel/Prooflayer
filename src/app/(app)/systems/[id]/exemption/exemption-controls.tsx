"use client";
// Dossier d'exemption (PL-205) : rédaction en brouillon, signature (nom, fonction, déclaration, mot de passe),
// exports de l'Annexe VIII section B.

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { EU_MEMBER_STATES } from "@/server/services/annex-viii";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const textareaClass =
  "min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal";

export interface DossierValues {
  conditionJustification: string;
  profilingJustification: string;
  providerName: string;
  providerAddress: string;
  providerContact: string;
  submitter: string;
  representative: string;
  tradeName: string;
  memberStates: string[];
}

export function DossierForm({ systemId, initial }: { systemId: string; initial: DossierValues }) {
  const t = useTranslations("exemption");
  const tc = useTranslations("common");
  const tl = useTranslations("countries");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<"saved" | "error" | null>(null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");
    start(async () => {
      setStatus(null);
      try {
        await trpc.exemption.save.mutate({
          systemId,
          fields: {
            conditionJustification: text("conditionJustification"),
            profilingJustification: text("profilingJustification"),
            providerName: text("providerName"),
            providerAddress: text("providerAddress"),
            providerContact: text("providerContact"),
            submitter: text("submitter"),
            representative: text("representative"),
            tradeName: text("tradeName"),
            memberStates: data.getAll("memberStates").map(String) as never,
          },
        });
        setStatus("saved");
        router.refresh();
      } catch {
        setStatus("error");
      }
    });
  };

  return (
    <form className="max-w-3xl space-y-5" onSubmit={onSubmit} aria-busy={pending}>
      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold">{t("assessment")}</legend>
        <Label>
          {t("conditionJustification")}
          <span className="font-normal text-muted-foreground">{t("conditionHint")}</span>
          <textarea
            name="conditionJustification"
            defaultValue={initial.conditionJustification}
            maxLength={4000}
            required
            className={textareaClass}
          />
        </Label>
        <Label>
          {t("profilingJustification")}
          <span className="font-normal text-muted-foreground">{t("profilingHint")}</span>
          <textarea
            name="profilingJustification"
            defaultValue={initial.profilingJustification}
            maxLength={4000}
            required
            className={textareaClass}
          />
        </Label>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold">{t("registration")}</legend>
        {(
          [
            ["providerName", 200, true],
            ["providerAddress", 500, true],
            ["providerContact", 300, true],
            ["submitter", 300, false],
            ["representative", 300, false],
            ["tradeName", 200, true],
          ] as const
        ).map(([name, max, required]) => (
          <Label key={name} className="max-w-xl">
            {t(name)}
            <Input name={name} defaultValue={initial[name]} maxLength={max} required={required} />
          </Label>
        ))}
        <fieldset>
          <legend className="text-sm font-medium">{t("memberStates")}</legend>
          <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">
            {EU_MEMBER_STATES.map((code) => (
              <label key={code} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="memberStates"
                  value={code}
                  defaultChecked={initial.memberStates.includes(code)}
                />
                {tl(code)}
              </label>
            ))}
          </div>
        </fieldset>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {t("save")}
      </Button>
      {status === "saved" && <Alert>{t("saved")}</Alert>}
      {status === "error" && <Alert tone="error">{tc("genericError")}</Alert>}
    </form>
  );
}

export function SignDossierDialog({
  systemId,
  locale,
  defaultName,
}: {
  systemId: string;
  locale: string;
  defaultName: string;
}) {
  const t = useTranslations("exemption");
  const tr = useTranslations("classificationResult");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    start(async () => {
      setError(null);
      try {
        await trpc.exemption.sign.mutate({
          systemId,
          name: String(data.get("name")),
          title: String(data.get("title")),
          password: String(data.get("password")),
          locale: locale === "en" ? "en" : "fr",
        });
        setOpen(false);
        router.refresh();
      } catch (err) {
        const reason = err instanceof TRPCClientError ? err.message : "";
        setError(
          reason === "classification.invalidPassword"
            ? tr("invalidPassword")
            : reason === "classification.tooManyAttempts"
              ? tr("tooManyAttempts")
              : tc("genericError"),
        );
      }
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button type="button">{t("sign")}</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-md border border-border bg-background p-6 shadow-lg">
          <Dialog.Title className="text-lg font-semibold">{t("sign")}</Dialog.Title>
          <Dialog.Description>{t("signIntro")}</Dialog.Description>
          <form className="space-y-3" onSubmit={onSubmit}>
            <Label>
              {tr("name")}
              <Input
                name="name"
                defaultValue={defaultName}
                maxLength={120}
                required
                autoComplete="name"
              />
            </Label>
            <Label>
              {tr("jobTitle")}
              <Input name="title" maxLength={120} required autoComplete="organization-title" />
            </Label>
            <div className="space-y-1">
              <p className="text-sm font-medium">{tr("statementLabel")}</p>
              <p className="rounded-md bg-muted p-2 text-sm" data-testid="dossier-statement">
                {t("statement")}
              </p>
            </div>
            <Label>
              {tr("password")}
              <Input name="password" type="password" required autoComplete="current-password" />
            </Label>
            {error && <Alert tone="error">{error}</Alert>}
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {tr("confirm")}
              </Button>
              <Dialog.Close asChild>
                <Button variant="outline" type="button">
                  {tr("cancel")}
                </Button>
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AnnexExportButtons({ systemId }: { systemId: string }) {
  const t = useTranslations("exemption");
  const tc = useTranslations("common");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const download = async (format: "csv" | "json") => {
    setPending(true);
    setError(false);
    try {
      const { filename, mimeType, content } = await trpc.exemption.annexViii.query({
        systemId,
        format,
      });
      const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" type="button" disabled={pending} onClick={() => download("csv")}>
        {t("exportCsv")}
      </Button>
      <Button variant="outline" type="button" disabled={pending} onClick={() => download("json")}>
        {t("exportJson")}
      </Button>
      {error && <Alert tone="error">{tc("genericError")}</Alert>}
    </div>
  );
}
