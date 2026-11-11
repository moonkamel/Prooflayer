"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AFTER_SIGN_IN_PATH, authClient } from "@/lib/auth-client";

export function AcceptInvitationButton({ invitationId }: { invitationId: string }) {
  const t = useTranslations("acceptInvitation");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const { error } = await authClient.organization.acceptInvitation({ invitationId });
          setPending(false);
          if (error) {
            setFailed(true);
            return;
          }
          // L'organisation rejointe devient l'organisation active de la session.
          router.push(AFTER_SIGN_IN_PATH);
          router.refresh();
        }}
      >
        {t("accept")}
      </button>
      {failed && <p role="alert">{t("invalid")}</p>}
    </>
  );
}
