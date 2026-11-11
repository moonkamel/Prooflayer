"use client";
// Questionnaire : une question par écran, barre de progression, « Pourquoi cette question ? » avec l'article et
// deux exemples, enregistrement automatique de chaque réponse, retour arrière (§5.1 étape 3, PL-203).

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { QUESTIONS, type QuestionId, type Response } from "@/server/classify/questionnaire";
import { trpc } from "@/lib/trpc";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ClassificationResult } from "./result";

type Draft = Awaited<ReturnType<typeof trpc.classification.draft.mutate>>;

/** Texte du règlement sur EUR-Lex, dans la langue de l'interface. */
const eurLex = (locale: string) =>
  `https://eur-lex.europa.eu/legal-content/${locale === "en" ? "EN" : "FR"}/TXT/?uri=CELEX:32024R1689`;

export function Questionnaire({
  systemId,
  initial,
  locale,
  defaultName,
}: {
  systemId: string;
  initial: Draft;
  locale: string;
  defaultName: string;
}) {
  const t = useTranslations("questionnaire");
  const tq = useTranslations("questionnaire.questions");
  const tc = useTranslations("common");
  const [draft, setDraft] = useState(initial);
  const [viewing, setViewing] = useState<QuestionId | null>(
    initial.result ? null : (initial.current ?? initial.answered.at(-1) ?? "aiSystem"),
  );
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<"saved" | "error" | null>(null);

  const run = (action: () => Promise<Draft>, after?: (d: Draft) => void) =>
    start(async () => {
      setStatus(null);
      try {
        const next = await action();
        setDraft(next);
        after?.(next);
      } catch {
        setStatus("error");
      }
    });

  if (viewing === null && draft.result) {
    return (
      <ClassificationResult
        systemId={systemId}
        classification={draft}
        locale={locale}
        canSign
        defaultName={defaultName}
        onEdit={() => setViewing(draft.answered[0] ?? "aiSystem")}
      />
    );
  }

  const id = viewing ?? "aiSystem";
  const question = QUESTIONS[id];
  const value = draft.responses[id];
  const index = draft.answered.indexOf(id);
  const position = index === -1 ? draft.answered.length + 1 : index + 1;
  const total = Math.max(draft.estimatedLength, position);
  const nextId = index === -1 ? null : (draft.answered[index + 1] ?? draft.current);
  const previousId = index === -1 ? draft.answered.at(-1) : draft.answered[index - 1];
  const isLast = index !== -1 && nextId === null;

  const save = (response: Response) => {
    // Affichage immédiat de la réponse ; l'état renvoyé par le serveur (chemin, branchements) le remplace ensuite.
    setDraft((d) => ({ ...d, responses: { ...d.responses, [id]: response } }));
    run(
      () => trpc.classification.saveAnswers.mutate({ systemId, questionId: id, value: response }),
      () => setStatus("saved"),
    );
  };

  const selected = Array.isArray(value) ? value : [];
  const toggle = (option: string, checked: boolean) =>
    save(checked ? [...selected, option] : selected.filter((o) => o !== option));

  return (
    <section aria-labelledby="questionnaire-title" className="max-w-3xl space-y-5">
      <h2 id="questionnaire-title">{t("title")}</h2>
      <p>{t("intro")}</p>
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground" id="questionnaire-progress">
          {t("progress", { current: position, total })}
        </p>
        <progress
          className="h-2 w-full"
          value={position}
          max={total}
          aria-labelledby="questionnaire-progress"
        />
      </div>

      <fieldset className="space-y-3" aria-busy={pending} data-testid="question" data-question={id}>
        <legend className="mb-2 text-lg font-semibold">{tq(`${id}.title`)}</legend>
        {question.kind === "yesNo" ? (
          <div className="flex gap-6">
            {[true, false].map((answer) => (
              <label key={String(answer)} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={id}
                  checked={value === answer}
                  onChange={() => save(answer)}
                />
                {answer ? t("yes") : t("no")}
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
                  onChange={(e) => toggle(option, e.target.checked)}
                />
                {tq(`${id}.options.${option}` as never)}
              </label>
            ))}
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={Array.isArray(value) && value.length === 0}
                onChange={(e) => e.target.checked && save([])}
              />
              {t("none")}
            </label>
          </div>
        )}
      </fieldset>

      <details className="rounded-md border border-border p-3" open>
        <summary className="cursor-pointer font-medium">{t("why")}</summary>
        <div className="mt-2 space-y-2 text-sm">
          <p>
            <a href={eurLex(locale)} target="_blank" rel="noreferrer">
              {question.articleRef}
            </a>
            {" — "}
            {tq(`${id}.why`)}
          </p>
          <p className="font-medium">{t("examples")}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{tq(`${id}.example1`)}</li>
            <li>{tq(`${id}.example2`)}</li>
          </ul>
        </div>
      </details>

      {status === "saved" && <Alert>{t("saved")}</Alert>}
      {status === "error" && <Alert tone="error">{tc("genericError")}</Alert>}

      <div className="flex flex-wrap gap-3">
        {previousId && (
          <Button variant="outline" type="button" onClick={() => setViewing(previousId)}>
            {t("previous")}
          </Button>
        )}
        {isLast ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              run(
                () => trpc.classification.compute.mutate({ systemId }),
                () => setViewing(null),
              )
            }
          >
            {t("compute")}
          </Button>
        ) : (
          <Button
            type="button"
            disabled={pending || value === undefined || !nextId}
            onClick={() => {
              setStatus(null);
              setViewing(nextId);
            }}
          >
            {t("next")}
          </Button>
        )}
      </div>
    </section>
  );
}
