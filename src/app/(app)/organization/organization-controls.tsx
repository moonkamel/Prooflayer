"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import type { OrgRole } from "@/generated/prisma/enums";
import { trpc } from "@/lib/trpc";

type RoleOption = { value: OrgRole; label: string };

/** Message d'erreur affichable : refus de rôle, dernier owner, ou erreur générique. */
function useErrorMessage() {
  const t = useTranslations("organization");
  const tc = useTranslations("common");
  return (error: unknown) => {
    if (error instanceof TRPCClientError) {
      if (error.message === "role.lastOwner") return t("lastOwner");
      if (error.data?.code === "FORBIDDEN") return t("forbidden");
    }
    return tc("genericError");
  };
}

function useMutation() {
  const router = useRouter();
  const toMessage = useErrorMessage();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: () => Promise<unknown>, onDone?: () => void) =>
    start(async () => {
      setError(null);
      try {
        await action();
        onDone?.();
        router.refresh();
      } catch (e) {
        setError(toMessage(e));
      }
    });
  return { pending, error, run };
}

export function RenameForm({ name }: { name: string }) {
  const t = useTranslations("organization");
  const { pending, error, run } = useMutation();
  return (
    <form
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const value = String(new FormData(e.currentTarget).get("name"));
        run(() => trpc.org.update.mutate({ name: value }));
      }}
    >
      <label>
        {t("name")}
        <input name="name" defaultValue={name} maxLength={120} required />
      </label>
      <button type="submit" disabled={pending}>
        {t("rename")}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function MemberRoleSelect({
  memberId,
  role,
  options,
}: {
  memberId: string;
  role: OrgRole;
  options: RoleOption[];
}) {
  const t = useTranslations("organization");
  const { pending, error, run } = useMutation();
  return (
    <>
      <select
        aria-label={t("changeRole")}
        defaultValue={role}
        disabled={pending}
        onChange={(e) =>
          run(() => trpc.org.members.setRole.mutate({ memberId, role: e.target.value as OrgRole }))
        }
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span role="alert">{error}</span>}
    </>
  );
}

export function RemoveMemberButton({ memberId }: { memberId: string }) {
  const t = useTranslations("organization");
  const { pending, error, run } = useMutation();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => trpc.org.members.remove.mutate({ memberId }))}
      >
        {t("remove")}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}

export function InviteForm({ options }: { options: RoleOption[] }) {
  const t = useTranslations("organization");
  const { pending, error, run } = useMutation();
  const [sentTo, setSentTo] = useState<string | null>(null);
  return (
    <form
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        const email = String(data.get("email"));
        const role = String(data.get("role")) as OrgRole;
        setSentTo(null);
        run(
          () => trpc.org.members.invite.mutate({ email, role }),
          () => {
            setSentTo(email);
            form.reset();
          },
        );
      }}
    >
      <label>
        {t("inviteEmail")}
        <input name="email" type="email" autoComplete="off" required />
      </label>
      <label>
        {t("inviteRole")}
        <select name="role" defaultValue="contributor">
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending}>
        {t("inviteSubmit")}
      </button>
      {sentTo && <p role="status">{t("invited", { email: sentTo })}</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const t = useTranslations("organization");
  const { pending, error, run } = useMutation();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => trpc.org.members.revokeInvitation.mutate({ invitationId }))}
      >
        {t("revoke")}
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
