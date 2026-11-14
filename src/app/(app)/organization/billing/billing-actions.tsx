"use client";

// Boutons de facturation (PL-601) : redirection vers Stripe Checkout ou vers le portail client Stripe.
import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const KNOWN = ["billing.alreadySubscribed", "billing.notConfigured", "billing.noCustomer"] as const;

function useRedirect() {
  const t = useTranslations("billing");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const go = (action: () => Promise<{ url: string }>) =>
    start(async () => {
      setError(null);
      try {
        window.location.assign((await action()).url);
      } catch (e) {
        const reason = e instanceof TRPCClientError ? e.message : "";
        setError(
          (KNOWN as readonly string[]).includes(reason)
            ? t(`errors.${reason.replace("billing.", "") as "alreadySubscribed"}`)
            : t("errors.generic"),
        );
      }
    });
  return { t, pending, error, go };
}

export function CheckoutButton({
  plan,
  interval,
}: {
  plan: "STARTER" | "GROWTH" | "SCALE";
  interval: "month" | "year";
}) {
  const { t, pending, error, go } = useRedirect();
  const locale = useLocale() === "en" ? "en" : "fr";
  return (
    <div className="space-y-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() => go(() => trpc.billing.checkout.mutate({ plan, interval, locale }))}
      >
        {t("subscribe")}
        <span className="sr-only">
          {" · "}
          {t(`plans.${plan}`)} · {t(`intervals.${interval}`)}
        </span>
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}

export function PortalButton() {
  const { t, pending, error, go } = useRedirect();
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => go(() => trpc.billing.portal.mutate())}
      >
        {t("portal")}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
