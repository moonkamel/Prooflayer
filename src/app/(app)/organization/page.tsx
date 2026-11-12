import type { Metadata } from "next";
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
import { Table, TableCell } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { parseJiraStatus } from "@/lib/integration-status";

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("organization"))("title") };
}

export default async function OrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ jira?: string }>;
}) {
  await requireSession();
  const jiraStatus = parseJiraStatus((await searchParams).jira);
  const api = await serverCaller();
  const org = await api.org.get();
  const members = await api.org.members.list();
  const isAdmin = ADMIN_ROLES.includes(org.role);
  const invitations = isAdmin ? await api.org.members.invitations() : [];
  const t = await getTranslations("organization");
  const tr = await getTranslations("roles");
  const format = await getFormatter();
  // Un admin n'attribue pas le rôle owner (§3.2 E10) : seul un owner le peut.
  const assignable = ORG_ROLES.filter((r) => org.role === "owner" || r !== "owner");
  const roleOptions = assignable.map((value) => ({ value, label: tr(value) }));

  return (
    <div className="space-y-4">
      <h1>{t("title")}</h1>
      {isAdmin ? <RenameForm name={org.name} /> : <p data-testid="org-name">{org.name}</p>}

      <section aria-labelledby="members-title">
        <h2 id="members-title">{t("membersTitle")}</h2>
        <Table>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} data-testid="member" data-email={m.email}>
                <TableCell>
                  {m.name} {m.isCurrentUser && `(${t("you")})`}
                </TableCell>
                <TableCell>{m.email}</TableCell>
                <TableCell data-testid="member-role">
                  {isAdmin && !m.isCurrentUser && (org.role === "owner" || m.role !== "owner") ? (
                    <MemberRoleSelect memberId={m.id} role={m.role} options={roleOptions} />
                  ) : (
                    tr(m.role)
                  )}
                </TableCell>
                <TableCell>
                  {isAdmin && !m.isCurrentUser && (org.role === "owner" || m.role !== "owner") && (
                    <RemoveMemberButton memberId={m.id} />
                  )}
                </TableCell>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      {isAdmin && (
        <>
          <section aria-labelledby="invite-title">
            <h2 id="invite-title">{t("inviteTitle")}</h2>
            <InviteForm options={roleOptions} />
          </section>
          {/* Connexion Jira (PL-403) ; la page Intégrations complète arrive avec PL-308. */}
          <section aria-labelledby="jira-title">
            <h2 id="jira-title">{t("jira.title")}</h2>
            {jiraStatus && (
              <Alert tone={jiraStatus === "connected" ? undefined : "error"}>
                {t(`jira.status.${jiraStatus}`)}
              </Alert>
            )}
            <p>{t("jira.description")}</p>
            <a href="/api/integrations/jira/start" data-testid="jira-connect">
              {t("jira.connect")}
            </a>
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
    </div>
  );
}
