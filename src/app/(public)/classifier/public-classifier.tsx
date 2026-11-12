"use client";
// Classifieur public (PL-208) : questionnaire et moteur exécutés dans le navigateur (fonctions pures partagées avec
// l'espace connecté), résultat avec sa trace, lien partageable, demande de la note PDF.

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { AiActRole, RiskTier } from "@/generated/prisma/enums";
import { classify } from "@/server/classify/engine";
import { implicationsOf, traceLines } from "@/server/classify/explain";
import {
  FIRST_QUESTION,
  QUESTIONS,
  nextQuestion,
  pathOf,
  pruneResponses,
  toAnswers,
  type QuestionId,
  type Response,
  type Responses,
} from "@/server/classify/questionnaire";
import { encodeResponses } from "@/server/classify/share";
import { regulationUrl } from "@/lib/regulation";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PublicClassifier({
  initial,
  locale,
  origin,
}: {
  initial: Responses;
  locale: string;
  origin: string;
}) {
  const t = useTranslations("publicClassifier");
  const tq = useTranslations("questionnaire");
  const [responses, setResponses] = useState<Responses>(initial);
  const path = pathOf(responses);
  const [viewing, setViewing] = useState<QuestionId | null>(
    path.current ?? (Object.keys(initial).length > 0 ? null : FIRST_QUESTION),
  );

  const set = (id: QuestionId, value: Response) => {
    const next = { ...responses, [id]: value };
    setResponses(next);
  };

  if (viewing === null && path.current === null) {
    return (
      <PublicResult
        responses={pruneResponses(responses)}
        locale={locale}
        origin={origin}
        onEdit={() => setViewing(path.answered[0] ?? FIRST_QUESTION)}
        onRestart={() => {
          setResponses({});
          setViewing(FIRST_QUESTION);
        }}
      />
    );
  }

  const id = viewing ?? path.current ?? FIRST_QUESTION;
  const question = QUESTIONS[id];
  const value = responses[id];
  const index = path.answered.indexOf(id);
  const position = index === -1 ? path.answered.length + 1 : index + 1;
  const total = Math.max(path.estimatedLength, position);
  const next = value === undefined ? null : nextQuestion(id, responses);
  const previous = index === -1 ? path.answered.at(-1) : path.answered[index - 1];
  const selected = Array.isArray(value) ? value : [];

  return (
    <section aria-labelledby="questionnaire-title" className="space-y-5">
      <h2 id="questionnaire-title" className="sr-only">
        {tq("title")}
      </h2>
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground" id="questionnaire-progress">
          {tq("progress", { current: position, total })}
        </p>
        <progress
          className="h-2 w-full"
          value={position}
          max={total}
          aria-labelledby="questionnaire-progress"
        />
      </div>
      <fieldset className="space-y-3" data-testid="question" data-question={id}>
        <legend className="mb-2 text-lg font-semibold">
          {tq(`questions.${id}.title` as never)}
        </legend>
        {question.kind === "yesNo" ? (
          <div className="flex gap-6">
            {[true, false].map((answer) => (
              <label key={String(answer)} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={id}
                  checked={value === answer}
                  onChange={() => set(id, answer)}
                />
                {answer ? tq("yes") : tq("no")}
              </label>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {question.options!.map((option) => (
              <label key={option} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.includes(option)}
                  onChange={(e) =>
                    set(
                      id,
                      e.target.checked
                        ? [...selected, option]
                        : selected.filter((o) => o !== option),
                    )
                  }
                />
                {tq(`questions.${id}.options.${option}` as never)}
              </label>
            ))}
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={Array.isArray(value) && value.length === 0}
                onChange={(e) => e.target.checked && set(id, [])}
              />
              {tq("none")}
            </label>
          </div>
        )}
      </fieldset>
      <details className="rounded-md border border-border p-3" open>
        <summary className="cursor-pointer font-medium">{tq("why")}</summary>
        <div className="mt-2 space-y-2 text-sm">
          <p>
            <a href={regulationUrl(locale)} target="_blank" rel="noreferrer">
              {question.articleRef}
            </a>
            {" — "}
            {tq(`questions.${id}.why` as never)}
          </p>
          <p className="font-medium">{tq("examples")}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{tq(`questions.${id}.example1` as never)}</li>
            <li>{tq(`questions.${id}.example2` as never)}</li>
          </ul>
        </div>
      </details>
      <div className="flex flex-wrap gap-3">
        {previous && (
          <Button variant="outline" type="button" onClick={() => setViewing(previous)}>
            {tq("previous")}
          </Button>
        )}
        {value !== undefined && next === null ? (
          <Button type="button" onClick={() => setViewing(null)}>
            {tq("compute")}
          </Button>
        ) : (
          <Button type="button" disabled={next === null} onClick={() => setViewing(next)}>
            {tq("next")}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t("disclaimer")}</p>
    </section>
  );
}

function PublicResult({
  responses,
  locale,
  origin,
  onEdit,
  onRestart,
}: {
  responses: Responses;
  locale: string;
  origin: string;
  onEdit: () => void;
  onRestart: () => void;
}) {
  const t = useTranslations("publicClassifier");
  const tr = useTranslations("classificationResult");
  const tk = useTranslations("riskTier");
  const ta = useTranslations("aiActRole");
  const format = useFormatter();
  const result = useMemo(() => classify(toAnswers(responses)), [responses]);
  const implications = implicationsOf(result.tier, result.annexIIIPoints);
  const shareUrl = `${origin}/classifier?r=${encodeResponses(responses)}`;
  const [copied, setCopied] = useState(false);

  return (
    <section
      aria-labelledby="public-result-title"
      className="space-y-5"
      data-testid="public-result"
    >
      <h2 id="public-result-title">{t("result")}</h2>
      <div className="grid gap-1 rounded-md border border-border p-4 sm:grid-cols-[1fr_auto]">
        <p className="text-lg font-bold uppercase" data-testid="result-tier">
          {tk(result.tier as RiskTier)}
        </p>
        <p className="sm:text-right">
          {result.annexIIIPoints.length > 0 &&
            tr("annex", { points: result.annexIIIPoints.join(", ") })}
        </p>
        <p data-testid="result-role">{tr("role", { role: ta(result.role as AiActRole) })}</p>
        <p className="text-sm text-muted-foreground sm:text-right">
          {tr("rules", { version: result.rulesetVersion })}
        </p>
      </div>
      <section aria-labelledby="public-why-title" className="space-y-2">
        <h3 id="public-why-title" className="font-semibold">
          {tr("why")}
        </h3>
        <ol className="list-decimal space-y-1 pl-6">
          {traceLines(result.reasoning).map((line) => (
            <li key={line.key} className={line.concludes ? "font-semibold" : undefined}>
              {tr(`trace.${line.key}` as never)}
              {" · "}
              <span className="text-sm font-normal text-muted-foreground">{line.articleRef}</span>
            </li>
          ))}
        </ol>
      </section>
      <p>
        {implications.applicationDate
          ? tr("application", {
              date: format.dateTime(new Date(implications.applicationDate), {
                dateStyle: "long",
                timeZone: "UTC",
              }),
            })
          : tr("noObligation")}
      </p>
      <p className="text-sm text-muted-foreground">{t("disclaimer")}</p>

      <div className="space-y-2">
        <Label>
          {t("share")}
          <Input readOnly value={shareUrl} data-testid="share-link" />
        </Label>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            type="button"
            onClick={async () => {
              await navigator.clipboard?.writeText(shareUrl).catch(() => undefined);
              setCopied(true);
            }}
          >
            {t("copy")}
          </Button>
          <Button variant="outline" type="button" onClick={onEdit}>
            {t("edit")}
          </Button>
          <Button variant="outline" type="button" onClick={onRestart}>
            {t("restart")}
          </Button>
        </div>
        {copied && <Alert>{t("copied")}</Alert>}
      </div>

      <NoteForm responses={responses} locale={locale} />

      <p>
        <Link href="/sign-up" className={buttonVariants()}>
          {t("signUp")}
        </Link>
      </p>
    </section>
  );
}

function NoteForm({ responses, locale }: { responses: Responses; locale: string }) {
  const t = useTranslations("publicClassifier");
  const tc = useTranslations("common");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email"));
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/public/classifier/note", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          contactConsent: data.get("consent") === "on",
          locale: locale === "en" ? "en" : "fr",
          systemName: String(data.get("systemName") ?? ""),
          responses,
        }),
      });
      if (response.ok) {
        setMessage({ tone: "info", text: t("sent", { email }) });
      } else {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setMessage({
          tone: "error",
          text:
            body.error === "publicClassifier.notProfessional"
              ? t("notProfessional")
              : response.status === 429
                ? t("tooMany")
                : tc("genericError"),
        });
      }
    } catch {
      setMessage({ tone: "error", text: tc("genericError") });
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="max-w-xl space-y-3 rounded-md border border-border p-4" onSubmit={onSubmit}>
      <h3 className="font-semibold">{t("noteTitle")}</h3>
      <p className="text-sm">{t("noteIntro")}</p>
      <Label>
        {t("systemName")}
        <Input name="systemName" maxLength={120} />
      </Label>
      <Label>
        {t("email")}
        <Input name="email" type="email" required autoComplete="email" maxLength={254} />
      </Label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="consent" className="mt-1" />
        {t("consent")}
      </label>
      <Button type="submit" disabled={pending}>
        {t("send")}
      </Button>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </form>
  );
}
