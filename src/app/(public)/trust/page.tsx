// Centre de confiance public (PL-606, §8.3) : architecture, chiffrement, intégrité, sauvegardes, sous-traitants,
// divulgation des vulnérabilités (security.txt) et pack d'audit de ProofLayer sur lui-même (§8.1).
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { fillLegal, legalEntity } from "@/lib/legal";
import { publicPackSummary } from "@/server/services/public-pack";
import { SubprocessorTable } from "./subprocessor-table";

export const dynamic = "force-dynamic";

const TOPICS = [
  "architecture",
  "encryption",
  "integrity",
  "access",
  "backups",
  "development",
] as const;

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("trust"))("title") };
}

export default async function TrustPage() {
  const t = await getTranslations("trust");
  const legal = await getTranslations("legal");
  const format = await getFormatter();
  const entity = legalEntity(process.env);
  const pack = await publicPackSummary();
  const day = (d: Date) => format.dateTime(d, { dateStyle: "long", timeZone: "UTC" });
  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <h1>{t("title")}</h1>
        <p>{t("intro")}</p>
      </header>
      <section aria-labelledby="pack" className="space-y-2">
        <h2 id="pack">{t("pack.title")}</h2>
        <p>{t("pack.body")}</p>
        {pack ? (
          <>
            <p>
              {t("pack.summary", {
                system: pack.systemName,
                start: day(pack.periodStart),
                end: day(pack.periodEnd),
                count: pack.evidenceCount,
                created: day(pack.createdAt),
              })}
            </p>
            {pack.manifestSha256 && (
              <p className="break-all font-mono text-xs">
                {t("pack.fingerprint", { hash: pack.manifestSha256 })}
              </p>
            )}
            <ul className="flex flex-wrap gap-4">
              <li>
                <a href="/api/public/pack" download>
                  {t("pack.download")}
                </a>
              </li>
              <li>
                <Link href="/verify">{t("pack.verify")}</Link>
              </li>
              <li>
                <a href="/.well-known/prooflayer-keys.json">{t("keys")}</a>
              </li>
            </ul>
          </>
        ) : (
          <p>{t("pack.unavailable")}</p>
        )}
      </section>
      {TOPICS.map((topic) => (
        <section key={topic} aria-labelledby={topic} className="space-y-2">
          <h2 id={topic}>{t(`${topic}.title`)}</h2>
          <p>{t(`${topic}.body`)}</p>
        </section>
      ))}
      <section aria-labelledby="subprocessors" className="space-y-2">
        <h2 id="subprocessors">{t("subprocessors.title")}</h2>
        <p>{t("subprocessors.body")}</p>
        <SubprocessorTable />
      </section>
      <section id="disclosure" aria-labelledby="disclosure-title" className="space-y-2">
        <h2 id="disclosure-title">{t("disclosure.title")}</h2>
        <p>{fillLegal(t.raw("disclosure.body") as string, entity.values, legal("placeholder"))}</p>
        <p>
          <a href="/.well-known/security.txt">{t("disclosure.securityTxt")}</a>
        </p>
      </section>
    </article>
  );
}
