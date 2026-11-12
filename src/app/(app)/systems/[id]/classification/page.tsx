// Classification d'un système (PL-203, PL-204, §5.3 écran A). La page ne fait que lire : le brouillon est créé par
// une action explicite (« Commencer le questionnaire », « Requalifier le système »). Brouillon en cours :
// questionnaire puis résultat à signer ; la version signée en vigueur et ses versions restent visibles.
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import type { AiActRole, RiskTier } from "@/generated/prisma/enums";
import { ADMIN_ROLES } from "@/server/services/role-policy";
import { requireSession } from "@/server/services/session";
import { Alert } from "@/components/ui/alert";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { loadSystem } from "../load";
import { Questionnaire } from "./questionnaire";
import { ClassificationResult, StartClassificationButton } from "./result";

type Params = { params: Promise<{ id: string }> };

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { system } = await loadSystem((await params).id);
  return { title: `${(await getTranslations("classificationResult"))("title")} · ${system.name}` };
}

export default async function ClassificationPage({ params }: Params) {
  const session = await requireSession();
  const { api, system } = await loadSystem((await params).id);
  const [org, current, versions] = await Promise.all([
    api.org.get(),
    api.classification.current({ systemId: system.id }),
    api.classification.history({ systemId: system.id }),
  ]);
  const canWrite = ADMIN_ROLES.includes(org.role) && !system.archivedAt;
  const locale = await getLocale();
  const t = await getTranslations("classificationResult");
  const tk = await getTranslations("riskTier");
  const ta = await getTranslations("aiActRole");
  const format = await getFormatter();
  const { draft, signed } = current;

  return (
    <>
      <nav aria-label={t("breadcrumb")} className="text-sm">
        <ol className="flex flex-wrap gap-2">
          <li>
            <Link href="/systems">{t("register")}</Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href={`/systems/${system.id}`}>{system.name}</Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{t("title")}</li>
        </ol>
      </nav>

      {draft && canWrite && (
        <Questionnaire
          systemId={system.id}
          initial={draft}
          locale={locale}
          defaultName={session.user.name}
        />
      )}
      {draft && signed && <Alert>{t("draftInProgress")}</Alert>}
      {!draft && !signed && (
        <section aria-labelledby="start-title" className="max-w-3xl space-y-3">
          <h2 id="start-title">{t("title")}</h2>
          <p>{t("notStarted")}</p>
          {canWrite ? (
            <StartClassificationButton systemId={system.id} label={t("start")} />
          ) : (
            <Alert>{t("readOnly")}</Alert>
          )}
        </section>
      )}
      {draft && !signed && !canWrite && <Alert>{t("readOnly")}</Alert>}

      {signed && (
        <ClassificationResult
          systemId={system.id}
          classification={signed}
          locale={locale}
          canSign={false}
          defaultName={session.user.name}
          headingKey={draft ? "inForce" : "title"}
          extraActions={
            !draft &&
            canWrite && (
              <StartClassificationButton
                systemId={system.id}
                label={t("requalify")}
                variant="outline"
              />
            )
          }
        />
      )}

      {versions.length > 0 && (
        <section aria-labelledby="versions-title" className="max-w-3xl space-y-2">
          <h2 id="versions-title">{t("versions")}</h2>
          <Table data-testid="classification-versions">
            <thead>
              <tr>
                <TableHead scope="col">{t("title")}</TableHead>
                <TableHead scope="col">{t("signedTitle")}</TableHead>
                <TableHead scope="col">{t("rulesHeader")}</TableHead>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} data-testid="classification-version" data-status={v.status}>
                  <TableCell>
                    {tk(v.tier as RiskTier)} · {ta(v.role as AiActRole)}
                    {v.annexIIIPoints.length > 0 && ` · ${v.annexIIIPoints.join(", ")}`}
                    {" — "}
                    {v.status === "SIGNED" ? t("versionCurrent") : t("versionSuperseded")}
                  </TableCell>
                  <TableCell>
                    {v.signedAt &&
                      t("signedBy", {
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
      )}
    </>
  );
}
