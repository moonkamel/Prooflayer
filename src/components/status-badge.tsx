// Les six statuts d'un contrôle (§3.2 E6, §5.2) : « chacun porte une icône, un libellé et une couleur.
// L'information n'est jamais portée par la couleur seule. » Jamais le mot « conforme » (règle 7 de CLAUDE.md).
import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleMinus,
  CircleX,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ControlStatus } from "@/generated/prisma/enums";

/** Couleurs de texte et de fond : contraste ≥ 4,5:1 vérifié par tests/unit/status-badge.test.tsx. */
export const STATUS_STYLES: Record<
  ControlStatus,
  { icon: LucideIcon; fg: string; bg: string; border: string }
> = {
  PASS: { icon: CircleCheck, fg: "#14532d", bg: "#dcfce7", border: "#86efac" },
  FAIL: { icon: CircleX, fg: "#7f1d1d", bg: "#fee2e2", border: "#fca5a5" },
  PARTIAL: { icon: CircleDashed, fg: "#713f12", bg: "#fef9c3", border: "#fde047" },
  STALE: { icon: Clock, fg: "#7c2d12", bg: "#ffedd5", border: "#fdba74" },
  MISSING: { icon: CircleHelp, fg: "#334155", bg: "#f1f5f9", border: "#cbd5e1" },
  NOT_APPLICABLE: { icon: CircleMinus, fg: "#3f3f46", bg: "#fafafa", border: "#d4d4d8" },
};

export const CONTROL_STATUSES = Object.keys(STATUS_STYLES) as ControlStatus[];

export function StatusBadge({ status }: { status: ControlStatus }) {
  const t = useTranslations("controlStatus");
  const { icon: Icon, fg, bg, border } = STATUS_STYLES[status];
  return (
    <span
      data-status={status}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{ color: fg, backgroundColor: bg, borderColor: border }}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {t(status)}
    </span>
  );
}
