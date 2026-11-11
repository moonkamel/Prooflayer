"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { revokeOtherSessionsAction, revokeSessionAction } from "./actions";
import { Button } from "@/components/ui/button";

export function RevokeSessionButton({ id }: { id: string }) {
  const t = useTranslations("account");
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      type="button"
      disabled={pending}
      onClick={() => start(() => revokeSessionAction(id))}
    >
      {t("revoke")}
    </Button>
  );
}

export function RevokeOtherSessionsButton() {
  const t = useTranslations("account");
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      type="button"
      disabled={pending}
      onClick={() => start(() => revokeOtherSessionsAction())}
    >
      {t("revokeOthers")}
    </Button>
  );
}

export function SignOutButton() {
  const t = useTranslations("account");
  const router = useRouter();
  return (
    <Button
      variant="outline"
      type="button"
      onClick={async () => {
        await authClient.signOut();
        router.push("/sign-in");
        router.refresh();
      }}
    >
      {t("signOut")}
    </Button>
  );
}

export function SwitchOrganizationButton({ organizationId }: { organizationId: string }) {
  const t = useTranslations("account");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await authClient.organization.setActive({ organizationId });
          router.refresh();
        })
      }
    >
      {t("switchTo")}
    </Button>
  );
}
