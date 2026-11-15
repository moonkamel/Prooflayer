// Liste de mise en route (PL-604, §5.1) : 5 étapes déduites de l'état de l'organisation, l'étape en cours mise en avant.
import Link from "next/link";
import { CircleCheck, Circle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { OnboardingStep, OnboardingStepId } from "@/server/services/onboarding-data";

export async function OnboardingChecklist({
  steps,
  current,
  done,
}: {
  steps: OnboardingStep[];
  current: OnboardingStepId | null;
  done: number;
}) {
  const t = await getTranslations("onboardingSteps");
  return (
    <section
      aria-labelledby="onboarding-title"
      data-testid="onboarding"
      className="space-y-3 rounded-md border border-border p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="onboarding-title">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("progress", { done, total: steps.length })}
        </p>
      </div>
      <ol className="space-y-2">
        {steps.map((step, i) => (
          <li
            key={step.id}
            data-testid="onboarding-step"
            data-step={step.id}
            data-done={step.done}
            aria-current={step.id === current ? "step" : undefined}
            className="flex items-start gap-2"
          >
            {step.done ? (
              <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            ) : (
              <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <div>
              <p className={step.id === current ? "font-medium" : undefined}>
                <span className="sr-only">{t(step.done ? "doneLabel" : "todoLabel")} · </span>
                {t("stepNumber", { number: i + 1 })} {t(`steps.${step.id}.title`)}
              </p>
              {step.id === current && (
                <p className="text-sm text-muted-foreground">
                  {t(`steps.${step.id}.help`)}{" "}
                  <Link href={step.href}>{t(`steps.${step.id}.action`)}</Link>
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
