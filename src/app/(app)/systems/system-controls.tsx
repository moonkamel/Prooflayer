"use client";
// Registre des systèmes d'IA (PL-201) : création en 3 champs, export, édition en place de la fiche,
// modifications de conception. Chaque écriture passe par le routeur `system` ; la page est ensuite rafraîchie.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type Option = { value: string; label: string };
export type ModelValue = { name: string; provider: string; version: string; isGpai: boolean };

const textareaClass =
  "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function useErrorMessage() {
  const t = useTranslations("systems");
  const tc = useTranslations("common");
  return (error: unknown) => {
    if (error instanceof TRPCClientError) {
      if (error.message === "system.ownerNotMember") return t("ownerNotMember");
      if (error.message === "system.conflict") return t("conflict");
      if (error.message === "system.archived") return t("archivedError");
      if (error.message === "billing.monitoredLimit") return t("monitoredLimit");
      if (error.message === "billing.readOnly") return t("readOnly");
      if (error.data?.code === "FORBIDDEN") return t("forbidden");
    }
    return tc("genericError");
  };
}

function useAction() {
  const router = useRouter();
  const toMessage = useErrorMessage();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<unknown>, onDone?: (result: unknown) => void) =>
    start(async () => {
      setError(null);
      try {
        const result = await action();
        onDone?.(result);
        router.refresh();
      } catch (e) {
        setError(toMessage(e));
      }
    });
  return { pending, error, run };
}

export function CreateSystemForm({
  people,
  defaultOwner,
}: {
  people: Option[];
  defaultOwner: string;
}) {
  const t = useTranslations("systems");
  const tf = useTranslations("systemFields");
  const router = useRouter();
  const { pending, error, run } = useAction();
  return (
    <form
      className="max-w-md space-y-3"
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        run(
          () =>
            trpc.system.create.mutate({
              name: String(data.get("name")),
              intendedPurpose: String(data.get("intendedPurpose")),
              ownerUserId: String(data.get("ownerUserId")),
            }),
          (result) => router.push(`/systems/${(result as { id: string }).id}`),
        );
      }}
    >
      <Label>
        {tf("name")}
        <Input name="name" maxLength={120} required />
      </Label>
      <Label>
        {tf("intendedPurpose")}
        <textarea name="intendedPurpose" maxLength={2000} required className={textareaClass} />
      </Label>
      <Label>
        {tf("ownerUserId")}
        <Select name="ownerUserId" defaultValue={defaultOwner}>
          {people.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </Label>
      <Button type="submit" disabled={pending}>
        {t("createSubmit")}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  );
}

export function ExportRegistryButtons() {
  const t = useTranslations("systems");
  const tc = useTranslations("common");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const download = async (format: "csv" | "json") => {
    setPending(true);
    setError(false);
    try {
      const { filename, mimeType, content } = await trpc.system.export.query({ format });
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

type Editor =
  | { kind: "text"; value: string; required?: boolean; maxLength: number }
  | { kind: "textarea"; value: string; required?: boolean; maxLength: number }
  | { kind: "date"; value: string }
  | { kind: "select"; value: string; options: Option[]; allowEmpty?: boolean }
  | { kind: "lines"; value: string[] }
  | { kind: "models"; value: ModelValue[] };

/**
 * Champ de fiche éditable en place : valeur affichée et bouton « Modifier » ; en édition, un formulaire au libellé
 * du champ, enregistré par system.update. Un utilisateur sans droit d'écriture voit la valeur seule.
 */
export function EditableField({
  systemId,
  field,
  label,
  display,
  editor,
  editable,
}: {
  systemId: string;
  field: string;
  label: string;
  display: ReactNode;
  editor: Editor;
  editable: boolean;
}) {
  const t = useTranslations("system");
  const [editing, setEditing] = useState(false);
  const { pending, error, run } = useAction();

  if (!editing) {
    return (
      <div className="grid gap-1 border-b border-border py-3 sm:grid-cols-[14rem_1fr_auto] sm:gap-4">
        <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
        <dd data-testid={`field-${field}`}>{display}</dd>
        {editable && (
          <dd>
            <Button
              variant="outline"
              size="sm"
              type="button"
              aria-label={t("editField", { field: label })}
              onClick={() => setEditing(true)}
            >
              {t("edit")}
            </Button>
          </dd>
        )}
      </div>
    );
  }

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    let value: unknown;
    switch (editor.kind) {
      case "lines":
        value = String(data.get("value")).split("\n");
        break;
      case "models":
        value = data.getAll("modelName").map((name, i) => ({
          name: String(name),
          provider: String(data.getAll("modelProvider")[i] ?? ""),
          version: String(data.getAll("modelVersion")[i] ?? ""),
          isGpai: data.getAll("modelGpai").includes(String(i)),
        }));
        break;
      case "date":
      case "select": {
        const raw = String(data.get("value"));
        value = raw === "" ? null : raw;
        break;
      }
      default:
        value = String(data.get("value"));
    }
    run(
      () => trpc.system.update.mutate({ id: systemId, patch: { [field]: value } }),
      () => setEditing(false),
    );
  };

  return (
    <div className="grid gap-1 border-b border-border py-3 sm:grid-cols-[14rem_1fr] sm:gap-4">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd>
        <form className="space-y-3" onSubmit={onSubmit}>
          {editor.kind === "models" ? (
            <fieldset className="space-y-2">
              <legend className="sr-only">{label}</legend>
              <ModelsEditor initial={editor.value} />
            </fieldset>
          ) : (
            <Label className="max-w-xl">
              <span className="sr-only">{label}</span>
              <FieldInput editor={editor} />
              {editor.kind === "lines" && (
                <span className="font-normal text-muted-foreground">{t("categoriesHint")}</span>
              )}
            </Label>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {t("save")}
            </Button>
            <Button variant="outline" size="sm" type="button" onClick={() => setEditing(false)}>
              {t("cancel")}
            </Button>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
        </form>
      </dd>
    </div>
  );
}

function FieldInput({ editor }: { editor: Exclude<Editor, { kind: "models" }> }) {
  const t = useTranslations("system");
  switch (editor.kind) {
    case "text":
      return (
        <Input
          name="value"
          defaultValue={editor.value}
          maxLength={editor.maxLength}
          required={editor.required}
          autoFocus
        />
      );
    case "textarea":
      return (
        <textarea
          name="value"
          defaultValue={editor.value}
          maxLength={editor.maxLength}
          required={editor.required}
          className={textareaClass}
          autoFocus
        />
      );
    case "date":
      return <Input name="value" type="date" defaultValue={editor.value} autoFocus />;
    case "select":
      return (
        <Select name="value" defaultValue={editor.value} autoFocus>
          {editor.allowEmpty && <option value="">{t("nobody")}</option>}
          {editor.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case "lines":
      return (
        <textarea
          name="value"
          defaultValue={editor.value.join("\n")}
          className={textareaClass}
          autoFocus
        />
      );
  }
}

function ModelsEditor({ initial }: { initial: ModelValue[] }) {
  const t = useTranslations("system");
  const [rows, setRows] = useState(() => initial.map((m, i) => ({ ...m, key: i })));
  const [nextKey, setNextKey] = useState(initial.length);
  return (
    <>
      {rows.map((row, i) => (
        <div key={row.key} className="flex flex-wrap items-end gap-2" data-testid="model-row">
          <Label>
            {t("modelName")}
            <Input name="modelName" defaultValue={row.name} maxLength={200} required />
          </Label>
          <Label>
            {t("modelProvider")}
            <Input name="modelProvider" defaultValue={row.provider} maxLength={200} />
          </Label>
          <Label>
            {t("modelVersion")}
            <Input name="modelVersion" defaultValue={row.version} maxLength={100} />
          </Label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="modelGpai" value={String(i)} defaultChecked={row.isGpai} />
            {t("modelGpai")}
          </label>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => setRows(rows.filter((r) => r.key !== row.key))}
          >
            {t("removeModel")}
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={() => {
          setRows([...rows, { name: "", provider: "", version: "", isGpai: false, key: nextKey }]);
          setNextKey(nextKey + 1);
        }}
      >
        {t("addModel")}
      </Button>
    </>
  );
}

export function ArchiveSystemButton({ systemId }: { systemId: string }) {
  const t = useTranslations("system");
  const { pending, error, run } = useAction();
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        type="button"
        disabled={pending}
        onClick={() => run(() => trpc.system.archive.mutate({ id: systemId }))}
      >
        {t("archive")}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

/** Surveillance (PL-602) : seuls les systèmes surveillés sont évalués et comptent dans la limite du plan. */
export function MonitorSystemButton({
  systemId,
  monitored,
}: {
  systemId: string;
  monitored: boolean;
}) {
  const t = useTranslations("system");
  const { pending, error, run } = useAction();
  return (
    <div className="space-y-2">
      <Button
        variant={monitored ? "outline" : "default"}
        type="button"
        disabled={pending}
        onClick={() =>
          run(() => trpc.system.setMonitored.mutate({ id: systemId, monitored: !monitored }))
        }
      >
        {t(monitored ? "stopMonitoring" : "startMonitoring")}
      </Button>
      {error && (
        <Alert tone="error">
          {error} <Link href="/organization/billing">{t("seePlans")}</Link>
        </Alert>
      )}
    </div>
  );
}

export function RecordDesignChangeForm({ systemId, today }: { systemId: string; today: string }) {
  const t = useTranslations("designChanges");
  const { pending, error, run } = useAction();
  const [added, setAdded] = useState(false);
  return (
    <form
      className="max-w-md space-y-3"
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        setAdded(false);
        run(
          () =>
            trpc.system.designChanges.create.mutate({
              systemId,
              occurredAt: String(data.get("occurredAt")),
              summary: String(data.get("summary")),
            }),
          () => {
            setAdded(true);
            form.reset();
          },
        );
      }}
    >
      <Label>
        {t("occurredAt")}
        <Input name="occurredAt" type="date" defaultValue={today} max={today} required />
      </Label>
      <Label>
        {t("summary")}
        <textarea name="summary" maxLength={2000} required className={textareaClass} />
      </Label>
      <Button type="submit" disabled={pending}>
        {t("submit")}
      </Button>
      {added && <Alert>{t("added")}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  );
}

export function QualifyDesignChangeForm({
  changeId,
  legend,
  current,
}: {
  changeId: string;
  legend: string;
  current: boolean | null;
}) {
  const t = useTranslations("designChanges");
  const { pending, error, run } = useAction();
  return (
    <form
      className="space-y-2"
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        run(
          () =>
            trpc.system.designChanges.qualify.mutate({
              id: changeId,
              isSignificant: data.get("isSignificant") === "yes",
              reason: String(data.get("reason")),
            }),
          () => form.reset(),
        );
      }}
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">{legend}</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="isSignificant"
              value="yes"
              required
              defaultChecked={current === true}
            />
            {t("significant")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="isSignificant"
              value="no"
              defaultChecked={current === false}
            />
            {t("notSignificant")}
          </label>
        </div>
        <Label>
          {t("reason")}
          <Input name="reason" maxLength={2000} required />
        </Label>
      </fieldset>
      <Button type="submit" size="sm" disabled={pending}>
        {current === null ? t("qualify") : t("requalify")}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  );
}
