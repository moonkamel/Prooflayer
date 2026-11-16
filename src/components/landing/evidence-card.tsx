// Illustration du héros : un contrôle tel qu'il apparaît dans ProofLayer (écran D), évalué à partir de preuves GitHub.
// Exemple fictif, signalé comme tel par sa légende. Statuts par <StatusBadge> (icône + libellé + couleur).
import { GitPullRequest, ShieldCheck, Stamp } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { StatusBadge } from "@/components/status-badge";

export async function EvidenceCard() {
  const t = await getTranslations("landing.card");
  const rows = [
    { icon: GitPullRequest, text: t("evidence1") },
    { icon: ShieldCheck, text: t("evidence2") },
    { icon: Stamp, text: t("evidence3") },
  ];
  return (
    <figure className="rounded-xl border border-border bg-background p-5 shadow-lg shadow-primary/5">
      <figcaption className="mb-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("label")}
      </figcaption>
      <p className="text-xs text-muted-foreground">{t("system")}</p>
      <div className="mt-3 space-y-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-medium">{t("control")}</p>
          <StatusBadge status="PASS" />
        </div>
        <p className="text-xs text-muted-foreground">{t("article")}</p>
        <ul className="space-y-2 text-sm">
          {rows.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2">
              <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
              {text}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3 space-y-1 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="font-medium">{t("next")}</p>
          <StatusBadge status="FAIL" />
        </div>
        <p className="text-sm text-muted-foreground">{t("nextReason")}</p>
      </div>
    </figure>
  );
}
