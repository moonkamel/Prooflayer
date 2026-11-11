// Coque de l'espace connecté (PL-109) : session obligatoire, 2FA obligatoire pour owner et admin (PL-103),
// en-tête avec navigation principale, organisation active et langue.
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { NavLink } from "@/components/shell/nav-link";
import { MAIN_ID, SkipLink } from "@/components/shell/skip-link";
import { listOwnMemberships } from "@/server/services/organization";
import { ADMIN_ROLES } from "@/server/services/role-policy";
import { activeOrganizationIdOf, requireSession } from "@/server/services/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const memberships = await listOwnMemberships(session.user.id);
  const active = memberships.find((m) => m.id === activeOrganizationIdOf(session));
  const t = await getTranslations("shell");

  return (
    <>
      <SkipLink />
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-2">
          <span className="font-semibold">{t("brand")}</span>
          <nav aria-label={t("mainNav")} className="flex flex-1 flex-wrap items-center gap-1">
            <NavLink href="/systems">{t("systems")}</NavLink>
            <NavLink href="/organization">{t("organization")}</NavLink>
            {active && ADMIN_ROLES.includes(active.role) && (
              <NavLink href="/audit">{t("audit")}</NavLink>
            )}
            <NavLink href="/account">{t("account")}</NavLink>
          </nav>
          {active && (
            <span className="text-xs text-muted-foreground" data-testid="active-organization">
              {t.rich("activeOrganization", {
                name: active.name,
                strong: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
              })}
            </span>
          )}
          <LanguageSwitcher />
        </div>
      </header>
      <main id={MAIN_ID} className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {children}
      </main>
    </>
  );
}
