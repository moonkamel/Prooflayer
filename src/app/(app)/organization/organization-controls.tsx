"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { TRPCClientError } from "@trpc/client";
import type { OrgRole } from "@/generated/prisma/enums";
import { trpc } from "@/lib/trpc";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
      className="max-w-md space-y-3"
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const value = String(new FormData(e.currentTarget).get("name"));
        run(() => trpc.org.update.mutate({ name: value }));
      }}
    >
      <Label>
        {t("name")}
        <Input name="name" defaultValue={name} maxLength={120} required />
      </Label>
      <Button type="submit" disabled={pending}>
        {t("rename")}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
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
      <Select
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
      </Select>
      {error && <Alert tone="error">{error}</Alert>}
    </>
  );
}

export function RemoveMemberButton({ memberId }: { memberId: string }) {
  const t = useTranslations("organization");
  const { pending, error, run } = useMutation();
  return (
    <>
      <Button
        variant="outline"
        type="button"
        disabled={pending}
        onClick={() => run(() => trpc.org.members.remove.mutate({ memberId }))}
      >
        {t("remove")}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </>
  );
}

export function InviteForm({ options }: { options: RoleOption[] }) {
  const t = useTranslations("organization");
  const { pending, error, run } = useMutation();
  const [sentTo, setSentTo] = useState<string | null>(null);
  return (
    <form
      className="max-w-md space-y-3"
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
      <Label>
        {t("inviteEmail")}
        <Input name="email" type="email" autoComplete="off" required />
      </Label>
      <Label>
        {t("inviteRole")}
        <Select name="role" defaultValue="contributor">
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Label>
      <Button type="submit" disabled={pending}>
        {t("inviteSubmit")}
      </Button>
      {sentTo && <Alert>{t("invited", { email: sentTo })}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
    </form>
  );
}

export function RevokeInvitationButton({ invitationId }: { invitationId: string }) {
  const t = useTranslations("organization");
  const { pending, error, run } = useMutation();
  return (
    <>
      <Button
        variant="outline"
        type="button"
        disabled={pending}
        onClick={() => run(() => trpc.org.members.revokeInvitation.mutate({ invitationId }))}
      >
        {t("revoke")}
      </Button>
      {error && <Alert tone="error">{error}</Alert>}
    </>
  );
}
