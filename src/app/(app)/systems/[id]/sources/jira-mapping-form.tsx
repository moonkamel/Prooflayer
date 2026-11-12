"use client";

// Correspondance Jira d'un système (PL-404) : requête JQL, prévisualisation du nombre de tickets, enregistrement.
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import type { JiraPurpose } from "@/server/connectors/jira/normalizers";
import { trpc } from "@/lib/trpc";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function JiraMappingForm(props: {
  systemId: string;
  integrationId: string;
  purpose: JiraPurpose;
  jql: string | null;
  defaultJql: string;
  canEdit: boolean;
}) {
  const t = useTranslations("sources.jira");
  const tc = useTranslations("common");
  const router = useRouter();
  const id = useId();
  const [jql, setJql] = useState(props.jql ?? props.defaultJql);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const fail = (error: unknown) =>
    setMessage({
      tone: "error",
      text:
        error instanceof TRPCClientError && error.message === "integration.jira.invalidJql"
          ? t("invalidJql")
          : tc("genericError"),
    });
  const preview = () =>
    start(async () => {
      try {
        const { count } = await trpc.integration.jira.previewQuery.mutate({
          integrationId: props.integrationId,
          jql,
        });
        setMessage({ tone: "info", text: t("count", { count }) });
      } catch (error) {
        fail(error);
      }
    });
  const save = () =>
    start(async () => {
      try {
        const { count } = await trpc.integration.jira.saveMapping.mutate({
          systemId: props.systemId,
          purpose: props.purpose,
          jql,
        });
        setMessage({ tone: "info", text: t("saved", { count }) });
        router.refresh();
      } catch (error) {
        fail(error);
      }
    });

  return (
    <div
      className="space-y-2 rounded-md border border-border p-3"
      data-testid={`jira-mapping-${props.purpose}`}
    >
      <Label htmlFor={id}>{t(`purposes.${props.purpose}`)}</Label>
      <p className="text-sm text-muted-foreground">{props.jql ? t("active") : t("notSaved")}</p>
      <Input
        id={id}
        value={jql}
        onChange={(e) => setJql(e.target.value)}
        maxLength={1000}
        readOnly={!props.canEdit}
        className="font-mono"
      />
      {props.canEdit && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending || !jql.trim()}
            onClick={preview}
          >
            {t("preview")}
          </Button>
          <Button type="button" disabled={pending || !jql.trim()} onClick={save}>
            {t("save")}
          </Button>
        </div>
      )}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </div>
  );
}
