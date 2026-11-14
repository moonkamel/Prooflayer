// Fil de veille réglementaire (PL-603, §3.2 E12) : entrées publiées par ProofLayer, avec source, date d'effet et
// contrôles concernés reliés aux contrôles des systèmes de l'organisation.
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { StatusBadge } from "@/components/status-badge";
import { regulationUrl } from "@/lib/regulation";
import { serverCaller } from "@/server/caller";
import { requireSession } from "@/server/services/session";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("watch"))("title") };
}

export default async function WatchPage() {
  await requireSession();
  const api = await serverCaller();
  const entries = await api.watch.list();
  const t = await getTranslations("watch");
  const format = await getFormatter();
  const locale = (await getLocale()) === "en" ? "en" : "fr";
  const day = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "long", timeZone: "UTC" });

  return (
    <div className="space-y-6">
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>
      {entries.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="space-y-4" data-testid="watch-entries">
          {entries.map((e) => (
            <li
              key={e.id}
              id={e.id}
              data-testid="watch-entry"
              className="space-y-3 rounded-md border border-border p-4"
            >
              <div className="space-y-1">
                <h2 className="text-lg">{e.title[locale]}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("published", { date: day(e.publishedAt) })}
                  {e.effectiveDate && <> · {t("effective", { date: day(e.effectiveDate) })}</>}
                  {" · "}
                  {t(`severity.${e.severity as "info"}`)}
                </p>
              </div>
              <p>{e.summary[locale]}</p>
              {e.source && (
                <p className="text-sm">
                  {t("source", { source: e.source[locale] })}{" "}
                  <a href={regulationUrl(locale)} target="_blank" rel="noopener noreferrer">
                    {t("regulation")}
                    <span className="sr-only"> · {t("newTab")}</span>
                  </a>
                </p>
              )}
              <section
                aria-label={t("controlsFor", { title: e.title[locale] })}
                className="space-y-2"
              >
                <h3 className="text-base">{t("controls")}</h3>
                <ul className="space-y-1 text-sm">
                  {e.controls.map((c) => (
                    <li key={c.key} data-testid="watch-control">
                      <span className="font-mono">{c.key}</span>
                      {c.instances.length === 0 ? (
                        <span className="text-muted-foreground"> · {t("notInScope")}</span>
                      ) : (
                        <ul className="mt-1 space-y-1 pl-4">
                          {c.instances.map((i) => (
                            <li key={i.controlId} className="flex flex-wrap items-center gap-2">
                              <Link href={`/systems/${i.systemId}/controls/${i.controlId}`}>
                                {i.systemName} · {i.title[locale]}
                              </Link>
                              <StatusBadge status={i.status} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
