// Réversibilité (PL-607) : export complet de l'organisation et suppression programmée. Réservé aux owners ; ouvert
// en lecture seule (un client qui part garde l'accès à ses données). §3.2 E11, §4.7.
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { serverCaller } from "@/server/caller";
import { requireSession } from "@/server/services/session";
import { DeletionControls, ExportButton } from "./data-actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("orgData"))("title") };
}

export default async function OrganizationDataPage() {
  await requireSession();
  const api = await serverCaller();
  const org = await api.org.get();
  const t = await getTranslations("orgData");
  const format = await getFormatter();
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "long", timeStyle: "short" });
  if (org.role !== "owner") {
    return (
      <div className="space-y-6">
        <p>
          <Link href="/organization">{t("back")}</Link>
        </p>
        <h1>{t("title")}</h1>
        <Alert>{t("ownerOnly")}</Alert>
      </div>
    );
  }
  const [exports, deletion] = await Promise.all([api.org.export.list(), api.org.deletion.get()]);

  return (
    <div className="space-y-6">
      <p>
        <Link href="/organization">{t("back")}</Link>
      </p>
      <h1>{t("title")}</h1>

      <section
        aria-labelledby="export-title"
        className="space-y-3 rounded-md border border-border p-4"
      >
        <h2 id="export-title">{t("export.title")}</h2>
        <p>{t("export.body")}</p>
        <ExportButton
          busy={exports.some((e) => e.status === "QUEUED" || e.status === "BUILDING")}
        />
        {exports.length === 0 ? (
          <p>{t("export.empty")}</p>
        ) : (
          <ul className="space-y-2" data-testid="exports">
            {exports.map((e) => (
              <li key={e.id}>
                {t("export.item", { date: date(e.createdAt) })}
                {" · "}
                {e.status === "READY" ? (
                  <a href={`/api/org/exports/${e.id}/download`} download>
                    {t("export.download", { count: e.counts?.evidence ?? 0 })}
                  </a>
                ) : (
                  t(`export.status.${e.status as "QUEUED"}`)
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="deletion-title"
        className="space-y-3 rounded-md border border-border p-4"
      >
        <h2 id="deletion-title">{t("deletion.title")}</h2>
        {deletion ? (
          <Alert tone="error" data-testid="deletion-scheduled">
            {t(`deletion.scheduled.${deletion.reason}`, { date: date(deletion.scheduledFor) })}
          </Alert>
        ) : (
          <p>{t("deletion.body", { slug: org.slug })}</p>
        )}
        <DeletionControls scheduled={Boolean(deletion)} slug={org.slug} />
      </section>
    </div>
  );
}
