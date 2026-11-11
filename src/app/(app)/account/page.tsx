import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { listOwnMemberships } from "@/server/services/organization";
import { activeOrganizationIdOf, listOwnSessions, requireSession } from "@/server/services/session";
import {
  RevokeOtherSessionsButton,
  RevokeSessionButton,
  SignOutButton,
  SwitchOrganizationButton,
} from "./session-controls";

export default async function AccountPage() {
  const session = await requireSession();
  const sessions = await listOwnSessions();
  const memberships = await listOwnMemberships(session.user.id);
  const activeOrgId = activeOrganizationIdOf(session);
  const t = await getTranslations("account");
  const tr = await getTranslations("roles");
  const to = await getTranslations("organization");
  const format = await getFormatter();

  return (
    <main>
      <h1>{t("title")}</h1>
      <p>
        {session.user.name} · {session.user.email}
      </p>

      <section aria-labelledby="organizations-title">
        <h2 id="organizations-title">{t("organizationsTitle")}</h2>
        <ul data-testid="organizations">
          {memberships.map((m) => (
            <li key={m.id} data-active={m.id === activeOrgId}>
              {m.name} · <span data-testid="membership-role">{tr(m.role)}</span>{" "}
              {m.id === activeOrgId ? (
                <strong>{t("active")}</strong>
              ) : (
                <SwitchOrganizationButton organizationId={m.id} />
              )}
            </li>
          ))}
        </ul>
        <Link href="/organization">{to("nav")}</Link>
      </section>

      <section aria-labelledby="two-factor-title">
        <h2 id="two-factor-title">{t("twoFactorTitle")}</h2>
        {session.user.twoFactorEnabled ? (
          <p data-testid="two-factor-status">{t("twoFactorOn")}</p>
        ) : (
          <p data-testid="two-factor-status">
            {t("twoFactorOff")} <Link href="/setup-two-factor">{t("enableTwoFactor")}</Link>
          </p>
        )}
      </section>

      <section aria-labelledby="sessions-title">
        <h2 id="sessions-title">{t("sessionsTitle")}</h2>
        <ul data-testid="sessions">
          {sessions.map((s) => (
            <li key={s.id} data-current={s.current}>
              <span>{s.userAgent ?? t("sessionUnknownDevice")}</span>{" "}
              <span>
                {t("sessionCreated", {
                  date: format.dateTime(s.createdAt, { dateStyle: "long", timeStyle: "short" }),
                })}
              </span>{" "}
              {s.current ? (
                <strong>{t("sessionCurrent")}</strong>
              ) : (
                <RevokeSessionButton id={s.id} />
              )}
            </li>
          ))}
        </ul>
        {sessions.length > 1 && <RevokeOtherSessionsButton />}
      </section>

      <SignOutButton />
    </main>
  );
}
