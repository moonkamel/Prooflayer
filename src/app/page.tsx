// Page d'accueil publique (site en anglais, ENGLISH_ONLY_PATHS) : présentation de ProofLayer, requête cible du §7.4
// « EU AI Act compliance software ». Rendue sans JavaScript client (FAQ en <details>), titres hiérarchisés, données
// structurées schema.org. Liens <a> (rechargement complet) : la page suivante reprend la langue de l'utilisateur au
// lieu de garder les traductions anglaises de cette page. Chaque appel à l'action mène au classifieur gratuit ou à l'essai (§7.4 : « chaque contenu
// se termine par le classifieur »).
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { LegalFooter } from "@/components/shell/legal-footer";
import { MAIN_ID, SkipLink } from "@/components/shell/skip-link";
import { EvidenceCard } from "@/components/landing/evidence-card";
import { StructuredData } from "@/components/landing/structured-data";
import { cn } from "@/lib/utils";
import { siteUrl } from "@/lib/site";

interface Item {
  title: string;
  body: string;
}
interface Plan {
  name: string;
  price: string;
  monthly?: string;
  summary: string;
  features: string[];
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing.meta");
  const url = siteUrl();
  return {
    metadataBase: url,
    // Même segment que la racine : le gabarit « %s · ProofLayer » ne s'applique pas, le titre est donné en entier.
    title: { absolute: `${t("title")} · ProofLayer` },
    description: t("description"),
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      url: "/",
      siteName: "ProofLayer",
      locale: "en_GB",
      title: t("title"),
      description: t("description"),
    },
    twitter: { card: "summary_large_image", title: t("title"), description: t("description") },
    robots: { index: true, follow: true },
  };
}

function SectionHeading({ id, title, lead }: { id: string; title: string; lead?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 id={id} className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h2>
      {lead && <p className="mt-3 text-muted-foreground">{lead}</p>}
    </div>
  );
}

export default async function HomePage() {
  const t = await getTranslations("landing");
  const shell = await getTranslations("shell");
  const jobs = t.raw("jobs.items") as Item[];
  const steps = t.raw("how.steps") as Item[];
  const rows = t.raw("coverage.rows") as { article: string; obligation: string; source: string }[];
  const points = t.raw("verify.points") as Item[];
  const audience = t.raw("audience.items") as Item[];
  const dates = t.raw("timeline.items") as { date: string; body: string }[];
  const plans = t.raw("pricing.plans") as Plan[];
  const faq = t.raw("faq.items") as { q: string; a: string }[];
  const nav = [
    ["how", "#how"],
    ["coverage", "#coverage"],
    ["verify", "#verify"],
    ["pricing", "#pricing"],
    ["faq", "#faq"],
  ] as const;

  return (
    <>
      <SkipLink />
      <StructuredData
        url={siteUrl().origin}
        name={shell("brand")}
        description={t("meta.description")}
        faq={faq}
      />
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold text-foreground no-underline"
          >
            <span aria-hidden="true" className="inline-block size-3 rotate-45 bg-gold" />
            {shell("brand")}
          </Link>
          <nav aria-label={t("nav.label")} className="hidden md:block">
            <ul className="flex items-center gap-5 text-sm">
              {nav.map(([key, href]) => (
                <li key={key}>
                  <a href={href} className="text-foreground no-underline hover:underline">
                    {t(`nav.${key}`)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <a href="/sign-in">{t("nav.signIn")}</a>
            <a href="/sign-up" className={buttonVariants({ size: "sm" })}>
              {t("nav.start")}
            </a>
          </div>
        </div>
      </header>

      <main id={MAIN_ID}>
        {/* Héros */}
        <section aria-labelledby="hero" className="bg-gradient-to-b from-accent to-background">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 lg:grid-cols-2 lg:py-24">
            <div className="space-y-6">
              <p className="text-sm font-semibold uppercase tracking-wide text-primary">
                {t("hero.eyebrow")}
              </p>
              <h1 id="hero" className="text-4xl font-bold tracking-tight sm:text-5xl">
                {t("hero.title")}
              </h1>
              <p className="text-lg text-muted-foreground">{t("hero.lead")}</p>
              <div className="flex flex-wrap items-center gap-3">
                <a href="/classifier" className={cn(buttonVariants(), "h-11 px-5 text-base")}>
                  {t("hero.primary")}
                </a>
                <a
                  href="/sign-up"
                  className={cn(buttonVariants({ variant: "outline" }), "h-11 px-5 text-base")}
                >
                  {t("hero.secondary")}
                </a>
              </div>
              <p className="text-sm text-muted-foreground">{t("hero.primaryHint")}</p>
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                {(["proof1", "proof2", "proof3", "proof4"] as const).map((key) => (
                  <li key={key} className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block size-1.5 rounded-full bg-primary"
                    />
                    {t(`hero.${key}`)}
                  </li>
                ))}
              </ul>
            </div>
            <EvidenceCard />
          </div>
        </section>

        {/* Les trois questions (jobs-to-be-done du §1.2) */}
        <section aria-labelledby="jobs" className="mx-auto max-w-6xl px-4 py-16">
          <SectionHeading id="jobs" title={t("jobs.title")} />
          <ul className="mt-10 grid gap-6 md:grid-cols-3">
            {jobs.map((job) => (
              <li key={job.title} className="rounded-xl border border-border p-6">
                <h3 className="text-lg font-semibold">{job.title}</h3>
                <p className="mt-2 text-muted-foreground">{job.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Fonctionnement */}
        <section aria-labelledby="how" className="scroll-mt-20 bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <SectionHeading id="how" title={t("how.title")} lead={t("how.lead")} />
            <ol className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, index) => (
                <li key={step.title} className="rounded-xl border border-border bg-background p-6">
                  <span
                    aria-hidden="true"
                    className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                  >
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Couverture article par article */}
        <section aria-labelledby="coverage" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
          <SectionHeading id="coverage" title={t("coverage.title")} lead={t("coverage.lead")} />
          <div className="mt-10 overflow-x-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">{t("coverage.caption")}</caption>
              <thead className="bg-surface">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t("coverage.colArticle")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t("coverage.colObligation")}
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    {t("coverage.colSource")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.article} className="border-t border-border">
                    <th scope="row" className="whitespace-nowrap px-4 py-3 font-medium">
                      {row.article}
                    </th>
                    <td className="px-4 py-3">{row.obligation}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Vérification sans nous */}
        <section aria-labelledby="verify" className="scroll-mt-20 bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <SectionHeading id="verify" title={t("verify.title")} lead={t("verify.lead")} />
            <ul className="mt-10 grid gap-6 md:grid-cols-2">
              {points.map((point) => (
                <li key={point.title} className="rounded-xl border border-border bg-background p-6">
                  <h3 className="text-lg font-semibold">{point.title}</h3>
                  <p className="mt-2 text-muted-foreground">{point.body}</p>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-col items-center gap-4 text-center">
              <p className="text-sm text-muted-foreground">
                {t("verify.commandLabel")}{" "}
                <code className="rounded bg-foreground px-2 py-1 font-mono text-background">
                  {t("verify.command")}
                </code>
              </p>
              <a href="/verify" className={buttonVariants({ variant: "outline" })}>
                {t("verify.cta")}
              </a>
            </div>
          </div>
        </section>

        {/* Pour qui */}
        <section aria-labelledby="audience" className="mx-auto max-w-6xl px-4 py-16">
          <SectionHeading id="audience" title={t("audience.title")} lead={t("audience.lead")} />
          <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {audience.map((item) => (
              <li key={item.title} className="rounded-xl border border-border p-6">
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{item.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Dates clés */}
        <section aria-labelledby="timeline" className="bg-surface">
          <div className="mx-auto max-w-4xl px-4 py-16">
            <SectionHeading id="timeline" title={t("timeline.title")} lead={t("timeline.lead")} />
            <ol className="mt-10 space-y-4 border-l-2 border-primary pl-6">
              {dates.map((item) => (
                <li key={item.date} className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute -left-[31px] top-1.5 size-3 rounded-full border-2 border-primary bg-background"
                  />
                  <p className="font-semibold">{item.date}</p>
                  <p className="text-muted-foreground">{item.body}</p>
                </li>
              ))}
            </ol>
            <p className="mt-8 rounded-lg border border-border bg-background p-4 text-sm">
              {t("timeline.note")}
            </p>
          </div>
        </section>

        {/* Tarifs (§6.1) */}
        <section aria-labelledby="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
          <SectionHeading id="pricing" title={t("pricing.title")} lead={t("pricing.lead")} />
          <ul className="mt-10 grid gap-6 lg:grid-cols-3">
            {plans.map((plan, index) => {
              const featured = index === 1;
              return (
                <li
                  key={plan.name}
                  className={cn(
                    "flex flex-col rounded-xl border p-6",
                    featured ? "border-primary shadow-lg shadow-primary/10" : "border-border",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xl font-semibold">{plan.name}</h3>
                    {featured && (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                        {t("pricing.featured")}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{plan.summary}</p>
                  <p className="mt-6">
                    <span className="text-3xl font-bold">{plan.price}</span>{" "}
                    <span className="text-sm text-muted-foreground">{t("pricing.perYear")}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {plan.monthly
                      ? t("pricing.monthly", { price: plan.monthly })
                      : t("pricing.noMonthly")}
                  </p>
                  <ul className="mt-6 flex-1 space-y-2 text-sm">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-primary"
                        />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <a
                    href="/sign-up"
                    className={cn(
                      buttonVariants({ variant: featured ? "default" : "outline" }),
                      "mt-6 w-full",
                    )}
                  >
                    {t("pricing.cta")}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Questions fréquentes (FAQPage) */}
        <section aria-labelledby="faq" className="scroll-mt-20 bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-16">
            <SectionHeading id="faq" title={t("faq.title")} />
            <div className="mt-10 divide-y divide-border rounded-xl border border-border bg-background">
              {faq.map((item) => (
                <details key={item.q} className="group p-5">
                  <summary className="cursor-pointer list-none font-semibold marker:hidden">
                    <h3 className="inline">{item.q}</h3>
                  </summary>
                  <p className="mt-3 text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Dernier appel : le classifieur */}
        <section aria-labelledby="final" className="bg-primary text-primary-foreground">
          <div className="mx-auto max-w-3xl space-y-5 px-4 py-16 text-center">
            <h2 id="final" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {t("final.title")}
            </h2>
            <p className="text-primary-foreground/90">{t("final.lead")}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <a
                href="/classifier"
                className="inline-flex h-11 items-center rounded-md bg-background px-5 font-medium text-primary no-underline hover:bg-accent"
              >
                {t("final.primary")}
              </a>
              <a
                href="/sign-up"
                className="inline-flex h-11 items-center rounded-md border border-primary-foreground px-5 font-medium text-primary-foreground no-underline hover:bg-primary-foreground/10"
              >
                {t("final.secondary")}
              </a>
            </div>
          </div>
        </section>
      </main>

      <div className="border-t border-border">
        <div className="mx-auto max-w-6xl space-y-2 px-4 pt-8 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">{shell("brand")}</p>
          <p>{t("footer.tagline")}</p>
          <p>{t("footer.disclaimer")}</p>
        </div>
        <LegalFooter width="max-w-6xl" fullReload />
      </div>
    </>
  );
}
