// Fiche système, onglet « Vue » (§5.3, écran B) : champs de la fiche éditables en place par owner et admin,
// encart « Classification à revoir » quand un champ utilisé par la classification a changé (§3.2 E2).
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { ADMIN_ROLES } from "@/server/services/role-policy";
import { AI_ACT_ROLES, SYSTEM_STATUSES, type SystemField } from "@/server/services/system-registry";
import { ArchiveSystemButton, EditableField } from "../system-controls";
import { Alert } from "@/components/ui/alert";
import { loadSystem } from "./load";

type Params = { params: Promise<{ id: string }> };

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { system } = await loadSystem((await params).id);
  return { title: system.name };
}

export default async function SystemOverviewPage({ params }: Params) {
  const { api, system } = await loadSystem((await params).id);
  const org = await api.org.get();
  const editable = ADMIN_ROLES.includes(org.role) && !system.archivedAt;
  const members = editable ? await api.org.members.list() : [];
  const t = await getTranslations("system");
  const tf = await getTranslations("systemFields");
  const tr = await getTranslations("aiActRole");
  const ts = await getTranslations("systemStatus");
  const format = await getFormatter();
  const people = members.map((m) => ({ value: m.userId, label: `${m.name} (${m.email})` }));
  const day = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "long", timeZone: "UTC" });
  const notSet = <span className="text-muted-foreground">{t("notSet")}</span>;
  const common = (field: SystemField) => ({
    systemId: system.id,
    field,
    label: tf(field),
    editable,
  });

  return (
    <>
      {system.archivedAt && <Alert>{t("archivedNotice", { date: day(system.archivedAt) })}</Alert>}
      {system.riskTier === "UNCLASSIFIED" && <Alert>{t("unclassified")}</Alert>}
      {system.classificationStale && (
        <Alert data-testid="classification-stale">
          <strong>{t("staleTitle")}</strong>
          {" — "}
          {system.staleCause
            ? t("staleCause", {
                field: tf(system.staleCause.field as SystemField),
                date: format.dateTime(new Date(system.staleCause.at), { dateStyle: "short" }),
              })
            : t("staleUnknown")}
        </Alert>
      )}

      <dl>
        <EditableField
          {...common("name")}
          display={system.name}
          editor={{ kind: "text", value: system.name, required: true, maxLength: 120 }}
        />
        <EditableField
          {...common("intendedPurpose")}
          display={<span className="whitespace-pre-line">{system.intendedPurpose}</span>}
          editor={{
            kind: "textarea",
            value: system.intendedPurpose,
            required: true,
            maxLength: 2000,
          }}
        />
        <EditableField
          {...common("description")}
          display={
            system.description ? (
              <span className="whitespace-pre-line">{system.description}</span>
            ) : (
              notSet
            )
          }
          editor={{ kind: "textarea", value: system.description ?? "", maxLength: 4000 }}
        />
        <EditableField
          {...common("role")}
          display={tr(system.role)}
          editor={{
            kind: "select",
            value: system.role,
            options: AI_ACT_ROLES.map((r) => ({ value: r, label: tr(r) })),
          }}
        />
        <EditableField
          {...common("vendorName")}
          display={system.vendorName ?? notSet}
          editor={{ kind: "text", value: system.vendorName ?? "", maxLength: 200 }}
        />
        <EditableField
          {...common("status")}
          display={ts(system.status)}
          editor={{
            kind: "select",
            value: system.status,
            options: SYSTEM_STATUSES.map((s) => ({ value: s, label: ts(s) })),
          }}
        />
        <EditableField
          {...common("placedOnMarketAt")}
          display={system.placedOnMarketAt ? day(system.placedOnMarketAt) : notSet}
          editor={{ kind: "date", value: system.placedOnMarketAt?.slice(0, 10) ?? "" }}
        />
        <EditableField
          {...common("models")}
          display={
            system.models.length === 0 ? (
              <span className="text-muted-foreground">{t("noModels")}</span>
            ) : (
              <ul className="space-y-1">
                {system.models.map((m, i) => (
                  <li key={i}>
                    {[m.name, m.version].filter(Boolean).join(" ")}
                    {(m.provider || m.isGpai) &&
                      ` (${[m.provider, m.isGpai ? t("gpai") : ""].filter(Boolean).join(", ")})`}
                  </li>
                ))}
              </ul>
            )
          }
          editor={{ kind: "models", value: system.models }}
        />
        <EditableField
          {...common("dataCategories")}
          display={
            system.dataCategories.length === 0 ? (
              <span className="text-muted-foreground">{t("noCategories")}</span>
            ) : (
              system.dataCategories.join(", ")
            )
          }
          editor={{ kind: "lines", value: system.dataCategories }}
        />
        <EditableField
          {...common("ownerUserId")}
          display={system.owner?.name ?? notSet}
          editor={{ kind: "select", value: system.owner?.id ?? "", options: people }}
        />
        <EditableField
          {...common("oversightOwnerUserId")}
          display={system.oversightOwner?.name ?? notSet}
          editor={{
            kind: "select",
            value: system.oversightOwner?.id ?? "",
            options: people,
            allowEmpty: true,
          }}
        />
      </dl>

      {editable && <ArchiveSystemButton systemId={system.id} />}
    </>
  );
}
