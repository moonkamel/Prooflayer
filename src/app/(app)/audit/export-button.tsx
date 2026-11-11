"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc";
import type { AuditAction } from "@/server/services/audit";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Filters = { action?: AuditAction; from?: string; to?: string };

/** Export CSV des entrées filtrées : le fichier est produit par le serveur et enregistré par le navigateur. */
export function ExportAuditButton({ filters }: { filters: Filters }) {
  const t = useTranslations("audit");
  const tc = useTranslations("common");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <p>
      <Button
        variant="outline"
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setMessage(null);
          try {
            const { filename, csv, truncated } = await trpc.audit.export.query(filters);
            const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
            const link = document.createElement("a");
            link.href = url;
            link.download = filename;
            link.click();
            URL.revokeObjectURL(url);
            if (truncated) setMessage(t("exportTruncated"));
          } catch {
            setMessage(tc("genericError"));
          } finally {
            setPending(false);
          }
        }}
      >
        {t("export")}
      </Button>
      {message && <Alert>{message}</Alert>}
    </p>
  );
}
