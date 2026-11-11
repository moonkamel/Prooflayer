import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { ADMIN_ROLES, ORG_ROLES } from "@/server/services/role-policy";
import { requireSession } from "@/server/services/session";
import {
  InviteForm,
  MemberRoleSelect,
  RemoveMemberButton,
  RenameForm,
  RevokeInvitationButton,
} from "./organization-controls";

export default async function OrganizationPage() {
  await requireSession();
  const api = await serverCaller();
  const org = await api.org.get();
  const members = await api.org.members.list();
  const isAdmin = ADMIN_ROLES.includes(org.role);
  const invitations = isAdmin ? await api.org.members.invitations() : [];
  const t = await getTranslations("organization");
  const tr = await getTranslations("roles");
  const ta = await getTranslations("audit");
  const format = await getFormatter();
  // Un admin n'attribue pas le rôle owner (§3.2 E10) : seul un owner le peut.
  const assignable = ORG_ROLES.filter((r) => org.role === "owner" || r !== "owner");
  const roleOptions = assignable.map((value) => ({ value, label: tr(value) }));

  return (
    <main>
      <h1>{t("title")}</h1>
      {isAdmin ? <RenameForm name={org.name} /> : <p data-testid="org-name">{org.name}</p>}
      {isAdmin && (
        <p>
          <Link href="/audit">{ta("nav")}</Link>
        </p>
      )}

      <section aria-labelledby="members-title">
        <h2 id="members-title">{t("membersTitle")}</h2>
        <table>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} data-testid="member" data-email={m.email}>
                <td>
                  {m.name} {m.isCurrentUser && `(${t("you")})`}
                </td>
                <td>{m.email}</td>
                <td data-testid="member-role">
                  {isAdmin && !m.isCurrentUser && (org.role === "owner" || m.role !== "owner") ? (
                    <MemberRoleSelect memberId={m.id} role={m.role} options={roleOptions} />
                  ) : (
                    tr(m.role)
                  )}
                </td>
                <td>
                  {isAdmin && !m.isCurrentUser && (org.role === "owner" || m.role !== "owner") && (
                    <RemoveMemberButton memberId={m.id} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {isAdmin && (
        <>
          <section aria-labelledby="invite-title">
            <h2 id="invite-title">{t("inviteTitle")}</h2>
            <InviteForm options={roleOptions} />
          </section>
          <section aria-labelledby="invitations-title">
            <h2 id="invitations-title">{t("invitationsTitle")}</h2>
            {invitations.length === 0 ? (
              <p>{t("noInvitations")}</p>
            ) : (
              <ul>
                {invitations.map((i) => (
                  <li key={i.id} data-testid="invitation" data-email={i.email}>
                    {i.email} · {tr(i.role)} ·{" "}
                    {t("invitationExpires", {
                      date: format.dateTime(new Date(i.expiresAt), { dateStyle: "long" }),
                    })}{" "}
                    <RevokeInvitationButton invitationId={i.id} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
