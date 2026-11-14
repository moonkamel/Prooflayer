// Facturation (PL-601, §3.2 E11) : abonnement en cours, essai, souscription par Stripe Checkout et portail client.
// Lecture : tout membre ; souscription et portail : owner. Le paiement lui-même se fait chez Stripe.
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { serverCaller } from "@/server/caller";
import { requireSession } from "@/server/services/session";
import { CheckoutButton, PortalButton } from "./billing-actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("billing"))("title") };
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  await requireSession();
  const checkout = (await searchParams).checkout;
  const api = await serverCaller();
  const org = await api.org.get();
  const billing = await api.billing.get();
  const t = await getTranslations("billing");
  const format = await getFormatter();
  const date = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: "long" }) : "—";
  const isOwner = org.role === "owner";
  const { access } = billing;
  const subscribed = billing.hasCustomer && billing.plan !== "TRIAL" && access.kind !== "readOnly";

  return (
    <div className="space-y-6">
      <p>
        <Link href="/organization">{t("back")}</Link>
      </p>
      <h1>{t("title")}</h1>
      {checkout === "success" && <Alert>{t("checkoutSuccess")}</Alert>}
      {checkout === "cancel" && <Alert>{t("checkoutCancel")}</Alert>}

      <section
        aria-labelledby="current-title"
        className="space-y-2 rounded-md border border-border p-4"
      >
        <h2 id="current-title">{t("current")}</h2>
        <p data-testid="billing-plan" className="text-lg font-medium">
          {t(`plans.${billing.plan}`)}
          {billing.interval && <> · {t(`intervals.${billing.interval as "month"}`)}</>}
        </p>
        <p data-testid="billing-access">
          {access.kind === "trial"
            ? t("trialLeft", { days: access.daysLeft, date: date(access.endsAt ?? null) })
            : access.kind === "active"
              ? billing.cancelAtPeriodEnd
                ? t("endsOn", { date: date(billing.currentPeriodEnd) })
                : t("renewsOn", { date: date(billing.currentPeriodEnd) })
              : t(`readOnly.${access.reason}`, { date: date(access.until ?? null) })}
        </p>
        <p>{t("systemsLimit", { count: billing.monitoredSystemsLimit })}</p>
        {isOwner && billing.hasCustomer && <PortalButton />}
      </section>

      {!subscribed && (
        <section aria-labelledby="offers-title" className="space-y-3">
          <h2 id="offers-title">{t("offersTitle")}</h2>
          {billing.offers.length === 0 ? (
            <Alert>{t("notConfigured")}</Alert>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {billing.offers.map((o) => (
                <li
                  key={`${o.plan}-${o.interval}`}
                  className="space-y-2 rounded-md border border-border p-4"
                  data-testid="billing-offer"
                >
                  <p className="font-medium">
                    {t(`plans.${o.plan}`)} · {t(`intervals.${o.interval}`)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t(`prices.${o.plan}_${o.interval}` as "prices.STARTER_year")}
                  </p>
                  <p className="text-sm">{t(`features.${o.plan}`)}</p>
                  {isOwner && <CheckoutButton plan={o.plan} interval={o.interval} />}
                </li>
              ))}
            </ul>
          )}
          {!isOwner && <p className="text-sm">{t("ownerOnly")}</p>}
          <p className="text-sm text-muted-foreground">{t("paymentNote")}</p>
        </section>
      )}
    </div>
  );
}
