// Fiche système (§5.3, écran B) : en-tête d'identité et navigation latérale par onglet.
// Onglets : Vue, Contrôles (PL-207), Changements, Historique. Preuves, Sources et Packs arrivent avec leurs tickets.
import type { ReactNode } from "react";
import { getFormatter, getTranslations } from "next-intl/server";
import { NavLink } from "@/components/shell/nav-link";
import { requireSession } from "@/server/services/session";
import { loadSystem } from "./load";

export default async function SystemLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const { system } = await loadSystem(id);
  const t = await getTranslations("system");
  const tr = await getTranslations("aiActRole");
  const ts = await getTranslations("systemStatus");
  const tk = await getTranslations("riskTier");
  const format = await getFormatter();
  const base = `/systems/${system.id}`;
  // Le rôle est un résultat de la classification (§5.1) : il n'est affiché qu'une fois le système qualifié.
  const identity =
    system.riskTier === "UNCLASSIFIED"
      ? tk(system.riskTier)
      : [tk(system.riskTier), ...system.annexIIIPoints, tr(system.role)].join(" · ");

  return (
    <div className="space-y-6">
      <header className="grid gap-2 border-b border-border pb-4 sm:grid-cols-[1fr_auto]">
        <h1 data-testid="system-name">{system.name}</h1>
        <p className="font-semibold uppercase sm:text-right" data-testid="system-identity">
          {identity}
        </p>
        <p className="text-sm text-muted-foreground">
          {system.placedOnMarketAt
            ? t("since", {
                status: ts(system.status),
                date: format.dateTime(new Date(system.placedOnMarketAt), {
                  dateStyle: "short",
                  timeZone: "UTC",
                }),
              })
            : ts(system.status)}
        </p>
        <p className="text-sm text-muted-foreground sm:text-right">
          {t("owner", { name: system.owner?.name ?? t("notSet") })}
        </p>
      </header>
      <div className="grid gap-6 md:grid-cols-[10rem_1fr]">
        <nav aria-label={t("sections")} className="flex flex-row flex-wrap gap-1 md:flex-col">
          <NavLink href={base} exact>
            {t("overview")}
          </NavLink>
          <NavLink href={`${base}/controls`}>
            {system.controlCount > 0
              ? t("controlsCount", { count: system.controlCount })
              : t("controls")}
          </NavLink>
          {system.riskTier === "HIGH_RISK_EXEMPT_ART6_3" && (
            <NavLink href={`${base}/exemption`}>{t("exemption")}</NavLink>
          )}
          <NavLink href={`${base}/changes`}>{t("changes")}</NavLink>
          <NavLink href={`${base}/history`}>{t("history")}</NavLink>
        </nav>
        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </div>
  );
}
