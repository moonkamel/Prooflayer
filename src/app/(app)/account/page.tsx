import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { listOwnSessions, requireSession } from "@/server/services/session";
import { RevokeOtherSessionsButton, RevokeSessionButton, SignOutButton } from "./session-controls";

export default async function AccountPage() {
  const session = await requireSession();
  const sessions = await listOwnSessions();
  const t = await getTranslations("account");
  const format = await getFormatter();

  return (
    <main>
      <h1>{t("title")}</h1>
      <p>
        {session.user.name} · {session.user.email}
      </p>

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
