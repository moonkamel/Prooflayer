"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { revokeOtherSessionsAction, revokeSessionAction } from "./actions";

export function RevokeSessionButton({ id }: { id: string }) {
  const t = useTranslations("account");
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(() => revokeSessionAction(id))}>
      {t("revoke")}
    </button>
  );
}

export function RevokeOtherSessionsButton() {
  const t = useTranslations("account");
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => revokeOtherSessionsAction())}
    >
      {t("revokeOthers")}
    </button>
  );
}

export function SignOutButton() {
  const t = useTranslations("account");
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut();
        router.push("/sign-in");
        router.refresh();
      }}
    >
      {t("signOut")}
    </button>
  );
}
