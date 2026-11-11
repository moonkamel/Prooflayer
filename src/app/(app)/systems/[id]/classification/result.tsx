"use client";
// Écran A du §5.3 — Résultat de classification : bandeau de catégorie, trace de raisonnement (chaque ligne dépliable
// vers la question et l'article), implications, actions. Variantes : exemption (Art. 6(4), 49(2)) et pratique
// interdite (pas de signature). Signature dans une fenêtre : nom, fonction, déclaration, mot de passe (PL-204).

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { TRPCClientError } from "@trpc/client";
import type { AiActRole, RiskTier } from "@/generated/prisma/enums";
import type { ClassifiedTier } from "@/server/classify/engine";
import { implicationsOf, traceLines } from "@/server/classify/explain";
import { type QuestionId, type Responses } from "@/server/classify/questionnaire";
import { trpc } from "@/lib/trpc";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type View = Awaited<ReturnType<typeof trpc.classification.draft.mutate>>;

const eurLex = (locale: string) =>
  `https://eur-lex.europa.eu/legal-content/${locale === "en" ? "EN" : "FR"}/TXT/?uri=CELEX:32024R1689`;

export function ClassificationResult({
  systemId,
  classification,
  locale,
  canSign,
  defaultName,
  onEdit,
  extraActions,
}: {
  systemId: string;
  classification: View;
  locale: string;
  canSign: boolean;
  defaultName: string;
  onEdit?: () => void;
  extraActions?: ReactNode;
}) {
  const t = useTranslations("classificationResult");
  const tq = useTranslations("questionnaire");
  const tk = useTranslations("riskTier");
  const tr = useTranslations("aiActRole");
  const format = useFormatter();
  const result = classification.result!;
  const tier = result.tier as ClassifiedTier;
  const implications = implicationsOf(tier, result.annexIIIPoints);
  const responses: Responses = classification.responses;
  const day = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "long", timeZone: "UTC" });

  const answerOf = (id: QuestionId) => {
    const value = responses[id];
    if (value === undefined) return t("noAnswer");
    if (typeof value === "boolean") return value ? tq("yes") : tq("no");
    if (value.length === 0) return tq("none");
    return value.map((o) => tq(`questions.${id}.options.${o}` as never)).join(" ; ");
  };

  return (
    <section
      aria-labelledby="result-title"
      className="max-w-3xl space-y-5"
      data-testid="classification-result"
    >
      <h2 id="result-title">{t("title")}</h2>
      <div className="grid gap-1 rounded-md border border-border p-4 sm:grid-cols-[1fr_auto]">
        <p className="text-lg font-bold uppercase" data-testid="result-tier">
          {tk(tier as RiskTier)}
        </p>
        <p className="sm:text-right">
          {result.annexIIIPoints.length > 0 &&
            t("annex", { points: result.annexIIIPoints.join(", ") })}
        </p>
        <p data-testid="result-role">{t("role", { role: tr(result.role as AiActRole) })}</p>
        <p className="text-sm text-muted-foreground sm:text-right">
          {t("rules", { version: classification.rulesetVersion })}
          {classification.status === "DRAFT" && ` · ${t("draft")}`}
        </p>
      </div>

      {tier === "PROHIBITED" && (
        <Alert tone="error">
          <strong>{t("prohibitedTitle")}</strong> {t("prohibitedBody")}
        </Alert>
      )}
      {tier === "HIGH_RISK_EXEMPT_ART6_3" && (
        <Alert>
          <strong>{t("exemptTitle")}</strong> {t("exemptBody")}
        </Alert>
      )}

      <section aria-labelledby="why-title" className="space-y-2">
        <h3 id="why-title" className="font-semibold">
          {t("why")}
        </h3>
        <ol className="list-decimal space-y-1 pl-6" data-testid="reasoning">
          {traceLines(result.reasoning).map((line) => (
            <li key={line.key}>
              <details>
                <summary
                  className={line.concludes ? "cursor-pointer font-semibold" : "cursor-pointer"}
                >
                  {t(`trace.${line.key}` as never)}
                </summary>
                <div className="mt-1 space-y-1 text-sm text-muted-foreground">
                  {line.questionId && (
                    <>
                      <p>
                        {t("question", {
                          question: tq(`questions.${line.questionId}.title` as never),
                        })}
                      </p>
                      <p>{t("answer", { answer: answerOf(line.questionId) })}</p>
                    </>
                  )}
                  <p>
                    <a href={eurLex(locale)} target="_blank" rel="noreferrer">
                      {line.articleRef}
                    </a>
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="implies-title" className="space-y-1">
        <h3 id="implies-title" className="font-semibold">
          {t("implies")}
        </h3>
        {implications.applicationDate ? (
          <p>
            {t("application", { date: day(implications.applicationDate) })}
            {" · "}
            {implications.applicationRef}
          </p>
        ) : (
          <p>{t("noObligation")}</p>
        )}
        {implications.assessment && (
          <p>
            {t(`assessment.${implications.assessment}`)}
            {" · "}
            {implications.assessmentRef}
          </p>
        )}
      </section>

      {classification.signature?.at && (
        <Alert data-testid="signature">
          <strong>{t("signedTitle")}</strong>
          {" — "}
          {t("signedBy", {
            date: day(classification.signature.at),
            name: classification.signature.name ?? "",
            title: classification.signature.title ?? "",
          })}{" "}
          {classification.signature.statement}
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {canSign && tier !== "PROHIBITED" && (
          <SignDialog systemId={systemId} locale={locale} defaultName={defaultName} />
        )}
        {onEdit && (
          <Button variant="outline" type="button" onClick={onEdit}>
            {t("edit")}
          </Button>
        )}
        <a
          href={`/api/systems/${systemId}/classifications/${classification.id}/note?lang=${locale}`}
          download
        >
          {t("pdf")}
        </a>
        {extraActions}
      </div>
    </section>
  );
}

function SignDialog({
  systemId,
  locale,
  defaultName,
}: {
  systemId: string;
  locale: string;
  defaultName: string;
}) {
  const t = useTranslations("classificationResult");
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
        await trpc.classification.sign.mutate({
          systemId,
          name: String(data.get("name")),
          title: String(data.get("title")),
          password: String(data.get("password")),
          locale: locale === "en" ? "en" : "fr",
        });
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(
          err instanceof TRPCClientError && err.message === "classification.invalidPassword"
            ? t("invalidPassword")
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
          <Dialog.Title className="text-lg font-semibold">{t("signTitle")}</Dialog.Title>
          <Dialog.Description>{t("signIntro")}</Dialog.Description>
          <form className="space-y-3" onSubmit={onSubmit}>
            <Label>
              {t("name")}
              <Input
                name="name"
                defaultValue={defaultName}
                maxLength={120}
                required
                autoComplete="name"
              />
            </Label>
            <Label>
              {t("jobTitle")}
              <Input name="title" maxLength={120} required autoComplete="organization-title" />
            </Label>
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("statementLabel")}</p>
              <p className="rounded-md bg-muted p-2 text-sm" data-testid="statement">
                {t("statement")}
              </p>
            </div>
            <Label>
              {t("password")}
              <Input name="password" type="password" required autoComplete="current-password" />
            </Label>
            {error && <Alert tone="error">{error}</Alert>}
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {t("confirm")}
              </Button>
              <Dialog.Close asChild>
                <Button variant="outline" type="button">
                  {t("cancel")}
                </Button>
              </Dialog.Close>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function RequalifyButton({ systemId }: { systemId: string }) {
  const t = useTranslations("classificationResult");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(false);
            try {
              await trpc.classification.draft.mutate({ systemId });
              router.refresh();
            } catch {
              setError(true);
            }
          })
        }
      >
        {t("requalify")}
      </Button>
      {error && <Alert tone="error">{tc("genericError")}</Alert>}
    </>
  );
}
