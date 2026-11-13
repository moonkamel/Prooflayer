// Alertes (PL-408, §3.2 E12) : préférences d'envoi de l'utilisateur pour l'organisation active et dernières alertes
// (régressions d'un contrôle, résumés quotidiens envoyés). Lien de pied de chaque email d'alerte.
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { requireSession } from "@/server/services/session";
import { MarkAllReadButton, PreferencesForm } from "./notification-forms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("notifications"))("title") };
}

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : 0);

export default async function NotificationsPage() {
  await requireSession();
  const api = await serverCaller();
  const [org, preferences, notifications] = await Promise.all([
    api.org.get(),
    api.notification.preferences.get(),
    api.notification.list(),
  ]);
  const t = await getTranslations("notifications");
  const format = await getFormatter();
  const unread = notifications.filter((n) => !n.read).map((n) => n.id);

  return (
    <div className="space-y-6">
      <h1>{t("title")}</h1>
      <p className="max-w-3xl text-muted-foreground">{t("intro", { organization: org.name })}</p>

      <section aria-labelledby="preferences-title" className="space-y-2">
        <h2 id="preferences-title">{t("preferences")}</h2>
        <p className="text-sm text-muted-foreground">{t("preferencesIntro")}</p>
        <PreferencesForm initial={preferences} />
      </section>

      <section aria-labelledby="recent-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="recent-title">{t("recent")}</h2>
          {unread.length > 0 && <MarkAllReadButton ids={unread} />}
        </div>
        {notifications.length === 0 ? (
          <p className="text-muted-foreground">{t("empty")}</p>
        ) : (
          <ol className="space-y-2" data-testid="notifications">
            {notifications.map((n) => (
              <li
                key={n.id}
                data-testid="notification"
                data-type={n.type}
                className="rounded-md border border-border p-3 data-[unread=true]:border-primary"
                data-unread={!n.read}
              >
                <p className="font-medium">
                  {n.type === "control.failed"
                    ? t("controlFailed", { key: str(n.payload.controlKey) })
                    : n.type === "pack.ready"
                      ? t("packReady", { system: str(n.payload.systemName) })
                      : t("digestDaily", {
                          day: str(n.payload.day),
                          expiring: num(n.payload.expiring),
                          integrations: num(n.payload.integrations),
                          stale: num(n.payload.staleClassifications),
                        })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("when", {
                    date: format.dateTime(new Date(n.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })}
                  {!n.read && <span> · {t("unread")}</span>}
                  {n.emailed && <span> · {t("emailed")}</span>}
                </p>
                {n.type === "pack.ready" && (
                  <p className="mt-1 text-sm">
                    <Link href={`/systems/${str(n.payload.systemId)}/packs`}>{t("openPacks")}</Link>
                  </p>
                )}
                {n.type === "control.failed" && (
                  <p className="mt-1 text-sm">
                    <Link
                      href={`/systems/${str(n.payload.systemId)}/controls/${str(n.payload.controlInstanceId)}`}
                    >
                      {t("openControl")}
                      <span className="sr-only"> · {str(n.payload.controlKey)}</span>
                    </Link>
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
