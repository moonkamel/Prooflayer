// Classification d'un système (PL-203, PL-204) : questionnaire et écran A (§5.3) pour le brouillon en cours ;
// classification signée en vigueur et ses versions sinon. Écriture : owner et admin (§4.4.2).
import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { TRPCError } from "@trpc/server";
import type { AiActRole, RiskTier } from "@/generated/prisma/enums";
import { ADMIN_ROLES } from "@/server/services/role-policy";
import { requireSession } from "@/server/services/session";
import { Alert } from "@/components/ui/alert";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { loadSystem } from "../load";
import { Questionnaire } from "./questionnaire";
import { ClassificationResult, RequalifyButton } from "./result";

type Params = { params: Promise<{ id: string }> };

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { system } = await loadSystem((await params).id);
  return { title: `${(await getTranslations("classificationResult"))("title")} · ${system.name}` };
}

export default async function ClassificationPage({ params }: Params) {
  const session = await requireSession();
  const { api, system } = await loadSystem((await params).id);
  const [org, current] = await Promise.all([
    api.org.get(),
    api.classification.current({ systemId: system.id }),
  ]);
  const isAdmin = ADMIN_ROLES.includes(org.role);
  const locale = await getLocale();
  const t = await getTranslations("questionnaire");

  if (!current.draft && current.signed) {
    const versions = await api.classification.history({ systemId: system.id });
    const tr = await getTranslations("classificationResult");
    const tk = await getTranslations("riskTier");
    const ta = await getTranslations("aiActRole");
    const format = await getFormatter();
    return (
      <>
        <ClassificationResult
          systemId={system.id}
          classification={current.signed}
          locale={locale}
          canSign={false}
          defaultName={session.user.name}
          extraActions={isAdmin && !system.archivedAt && <RequalifyButton systemId={system.id} />}
        />
        <section aria-labelledby="versions-title" className="max-w-3xl space-y-2">
          <h2 id="versions-title">{tr("versions")}</h2>
          <Table data-testid="classification-versions">
            <thead>
              <tr>
                <TableHead scope="col">{tr("title")}</TableHead>
                <TableHead scope="col">{tr("signedTitle")}</TableHead>
                <TableHead scope="col">{tr("rulesHeader")}</TableHead>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} data-testid="classification-version" data-status={v.status}>
                  <TableCell>
                    {tk(v.tier as RiskTier)} · {ta(v.role as AiActRole)}
                    {v.annexIIIPoints.length > 0 && ` · ${v.annexIIIPoints.join(", ")}`}
                    {" — "}
                    {v.status === "SIGNED" ? tr("versionCurrent") : tr("versionSuperseded")}
                  </TableCell>
                  <TableCell>
                    {v.signedAt &&
                      tr("signedBy", {
                        date: format.dateTime(new Date(v.signedAt), { dateStyle: "long" }),
                        name: v.signedByName ?? "",
                        title: v.signedByTitle ?? "",
                      })}
                  </TableCell>
                  <TableCell>{v.rulesetVersion}</TableCell>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      </>
    );
  }

  let draft: Awaited<ReturnType<typeof api.classification.draft>>;
  try {
    draft = current.draft ?? (await api.classification.draft({ systemId: system.id }));
  } catch (error) {
    if (error instanceof TRPCError && (error.code === "FORBIDDEN" || error.code === "CONFLICT")) {
      return (
        <section aria-labelledby="questionnaire-title" className="space-y-3">
          <h2 id="questionnaire-title">{t("title")}</h2>
          <Alert tone="error">{error.code === "FORBIDDEN" ? t("forbidden") : t("archived")}</Alert>
        </section>
      );
    }
    throw error;
  }
  if (!isAdmin) {
    return (
      <section aria-labelledby="questionnaire-title" className="space-y-3">
        <h2 id="questionnaire-title">{t("title")}</h2>
        <Alert tone="error">{t("forbidden")}</Alert>
      </section>
    );
  }
  return (
    <Questionnaire
      systemId={system.id}
      initial={draft}
      locale={locale}
      defaultName={session.user.name}
    />
  );
}
