"use client";

// Écran 7 (PL-604) : relecture toutes les 3 secondes de `onboarding.capture`. Le décompte est annoncé avec
// aria-live « polite » (une phrase de synthèse, pas chaque ligne) ; aucune animation (prefers-reduced-motion respecté
// d'office).
import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Alert } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/routers/_app";

type Capture = inferRouterOutputs<AppRouter>["onboarding"]["capture"];
const REFRESH_MS = 3_000;

export function LiveCapture({ systemId, initial }: { systemId: string; initial: Capture }) {
  const t = useTranslations("capture");
  const tk = useTranslations("evidenceKinds");
  const [data, setData] = useState(initial);
  const locale = useLocale() === "en" ? "en" : "fr";
  useEffect(() => {
    const timer = setInterval(() => {
      trpc.onboarding.capture.query({ systemId }).then(setData, () => undefined);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [systemId]);
  const kindLabel = (kind: string) => {
    const key = kind.replaceAll(".", "_");
    return tk.has(key as "manual_upload") ? tk(key as "manual_upload") : kind;
  };
  const evaluated = data.controls.length - data.pending;

  return (
    <section aria-labelledby="capture-title" className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="capture-title">{t("title")}</h2>
        <Link href={`/systems/${systemId}/dashboard`}>{t("dashboard")}</Link>
      </div>
      <p className="text-muted-foreground">{t("intro")}</p>
      {data.linkedSources === 0 && (
        <Alert>
          {t("noSource")} <Link href={`/systems/${systemId}/sources`}>{t("linkSource")}</Link>
        </Alert>
      )}
      <p
        role="status"
        aria-live="polite"
        data-testid="capture-summary"
        className="text-lg font-medium"
      >
        {t("summary", { total: data.total, evaluated, controls: data.controls.length })}
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        <section aria-labelledby="capture-evidence" className="space-y-2">
          <h3 id="capture-evidence">{t("byKind")}</h3>
          {data.evidence.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock aria-hidden="true" className="size-4" />
              {t("waiting")}
            </p>
          ) : (
            <table className="w-full text-sm" data-testid="capture-kinds">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 font-medium">
                    {t("kind")}
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    {t("count")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.evidence.map((e) => (
                  <tr key={e.kind} className="border-t border-border">
                    <td className="py-1">{kindLabel(e.kind)}</td>
                    <td className="py-1 text-right tabular-nums">{e.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section aria-labelledby="capture-controls" className="space-y-2">
          <h3 id="capture-controls">{t("controls")}</h3>
          {data.controls.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noControls")}</p>
          ) : (
            <ul className="space-y-1 text-sm" data-testid="capture-controls">
              {data.controls.map((c) => (
                <li key={c.id} data-status={c.status} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{c.key}</span>
                  <span className="flex-1">{c.title[locale]}</span>
                  {c.status === "PENDING" ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Clock aria-hidden="true" className="size-3.5" />
                      {t("pending")}
                    </span>
                  ) : (
                    <StatusBadge status={c.status} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
