// Écran D (§5.3) : détail d'un contrôle et de ses preuves (PL-407), complété du scellement (PL-503). En-tête,
// dernière évaluation et ses raisons, frise de 12 semaines, preuves (fautives en tête) avec lien vers la source,
// preuve attendue si le contrôle est sans preuve ; responsable, non-applicabilité justifiée, commentaires.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, ExternalLink, ShieldCheck, TriangleAlert } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { TRPCError } from "@trpc/server";
import { STATUS_STYLES, StatusBadge } from "@/components/status-badge";
import { Alert } from "@/components/ui/alert";
import { Table, TableCell, TableHead } from "@/components/ui/table";
import { ADMIN_ROLES, WRITE_ROLES } from "@/server/services/role-policy";
import { loadSystem } from "../../load";
import { CommentForm, NotApplicableForm, OwnerForm, RedactEvidenceForm } from "./control-forms";

type Params = {
  params: Promise<{ id: string; controlId: string }>;
  searchParams: Promise<{ page?: string }>;
};

async function loadControl(systemId: string, controlId: string, page = 1) {
  const { api, system } = await loadSystem(systemId);
  try {
    const control = await api.control.get({ controlId, page });
    if (control.system.id !== system.id) notFound();
    return { api, system, control };
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id, controlId } = await params;
  const { control } = await loadControl(id, controlId);
  const t = await getTranslations("controlDetail");
  return { title: `${t("title", { key: control.key })} · ${control.system.name}` };
}

export default async function ControlDetailPage({ params, searchParams }: Params) {
  const { id, controlId } = await params;
  const page = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  const { api, system, control } = await loadControl(id, controlId, page);
  const org = await api.org.get();
  const t = await getTranslations("controlDetail");
  const ta = await getTranslations("controls.automation");
  const ts = await getTranslations("controlStatus");
  const tk = await getTranslations("evidenceKinds");
  const format = await getFormatter();
  const locale = (await getLocale()) === "en" ? "en" : "fr";
  const writable = !control.system.archived;
  const canWrite = writable && WRITE_ROLES.includes(org.role);
  const canAdmin = writable && ADMIN_ROLES.includes(org.role);
  const base = `/systems/${system.id}/controls/${control.id}`;
  const dateTime = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const { expected, evidence } = control;
  const noEvidence = evidence.total === 0;

  return (
    <article aria-labelledby="control-title" className="space-y-6">
      <p className="text-sm">
        <Link href={`/systems/${system.id}/controls`}>{t("back")}</Link>
      </p>

      <header className="space-y-2 rounded-md border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            <code className="font-semibold text-foreground">{control.key}</code>
            {" · "}
            {control.articleRef}
          </p>
          <p className="flex items-center gap-2 text-sm">
            <span data-testid="control-status">
              <StatusBadge status={control.status} />
            </span>
            <span className="text-muted-foreground">{ta(control.automation)}</span>
          </p>
        </div>
        <h2 id="control-title">{control.title[locale]}</h2>
        <p>{control.statement[locale]}</p>
        <p className="text-sm" data-testid="control-owner">
          {control.owner
            ? t("owner", { name: control.owner.name ?? t("formerMember") })
            : t("noOwner")}
        </p>
        {control.notApplicable && (
          <Alert>
            {control.naByReclassification
              ? t("naByReclassification")
              : t("naJustification", { justification: control.naJustification ?? "" })}
          </Alert>
        )}
      </header>

      <section aria-labelledby="evaluation-title" className="space-y-3">
        <h3 id="evaluation-title">{t("evaluationTitle")}</h3>
        {control.lastEvaluation ? (
          <>
            <p data-testid="last-evaluation">
              {t("lastEvaluation", {
                when: dateTime(control.lastEvaluation.evaluatedAt),
                status: ts(control.lastEvaluation.status),
              })}
            </p>
            {control.lastEvaluation.reasons.length > 0 && (
              <ul className="list-disc space-y-1 pl-6" data-testid="reasons">
                {control.lastEvaluation.reasons.map((r, i) => (
                  <li key={`${r.code}-${i}`}>{r.message[locale]}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              {t("evaluator", { version: control.lastEvaluation.evaluatorVersion })}
            </p>
          </>
        ) : (
          <p>{t("neverEvaluated")}</p>
        )}
        <div>
          <h4 id="history-title" className="text-sm font-medium">
            {t("historyTitle")}
          </h4>
          <ol aria-labelledby="history-title" className="mt-1 flex flex-wrap gap-1">
            {control.history.map((h) => {
              const style = h.status ? STATUS_STYLES[h.status] : null;
              const Icon = style?.icon;
              const label = t("historyWeek", {
                week: date(h.week),
                status: h.status ? ts(h.status) : t("historyNone"),
              });
              return (
                <li
                  key={h.week}
                  title={label}
                  data-testid="history-week"
                  data-status={h.status ?? "NONE"}
                  className="flex size-7 items-center justify-center rounded border"
                  style={
                    style
                      ? { color: style.fg, backgroundColor: style.bg, borderColor: style.border }
                      : undefined
                  }
                >
                  {Icon && <Icon aria-hidden="true" className="size-4" />}
                  <span className="sr-only">{label}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section aria-labelledby="evidence-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="evidence-title">{t("evidenceTitle", { count: evidence.total })}</h3>
          {canWrite && expected.manual && !control.notApplicable && (
            <Link href={`${base}/evidence`}>{t("addEvidence")}</Link>
          )}
        </div>
        {evidence.faulty > 0 && (
          <Alert tone="error">{t("faultyFirst", { count: evidence.faulty })}</Alert>
        )}
        {noEvidence ? (
          <div
            className="space-y-2 rounded-md border border-dashed border-border p-4"
            data-testid="expected"
          >
            <h4 className="font-medium">{t("expectedTitle")}</h4>
            <ul className="list-disc space-y-1 pl-6">
              {expected.kinds.map((k) => (
                <li key={k}>{tk(k.replaceAll(".", "_") as "manual_upload")}</li>
              ))}
            </ul>
            {expected.path && <p>{t("expectedPath", { path: expected.path })}</p>}
            {expected.freshnessDays !== null && (
              <p>{t("expectedFreshness", { days: expected.freshnessDays })}</p>
            )}
            {expected.jiraPurpose && (
              <p>
                {t("expectedJira", {
                  purpose: t(`jiraPurposes.${expected.jiraPurpose as "risks"}`),
                })}{" "}
                <Link href={`/systems/${system.id}/sources`}>{t("openSources")}</Link>
              </p>
            )}
            {expected.connector === "GITHUB" && <p>{t("expectedGitHub")}</p>}
            {expected.manual && <p>{t("expectedManual")}</p>}
          </div>
        ) : (
          <>
            <Table data-testid="evidence">
              <thead>
                <tr>
                  <TableHead scope="col">{t("evidence")}</TableHead>
                  <TableHead scope="col">{t("kind")}</TableHead>
                  <TableHead scope="col">{t("occurredAt")}</TableHead>
                  <TableHead scope="col">{t("source")}</TableHead>
                  <TableHead scope="col">{t("seal")}</TableHead>
                </tr>
              </thead>
              <tbody>
                {evidence.items.map((e) => (
                  <tr key={e.id} data-testid="evidence-row" data-faulty={e.faulty}>
                    <TableCell>
                      <p className="flex items-start gap-1 font-medium">
                        {e.faulty && (
                          <TriangleAlert
                            aria-hidden="true"
                            className="mt-0.5 size-4 shrink-0 text-destructive"
                          />
                        )}
                        {e.redacted ? t("redacted") : e.summary}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {e.faulty && <span>{t("faulty")} · </span>}
                        {e.declarative && <span>{t("declarative")} · </span>}
                        {e.validUntil && (
                          <span>{t("validUntil", { date: date(e.validUntil) })} · </span>
                        )}
                        <span>{t(e.linkedByUser ? "linkedByUser" : "linkedByRule")}</span>
                      </p>
                      {canAdmin && !e.redacted && (
                        <RedactEvidenceForm evidenceId={e.id} summary={e.summary} />
                      )}
                    </TableCell>
                    <TableCell>{tk(e.kind.replaceAll(".", "_") as "manual_upload")}</TableCell>
                    <TableCell>{date(e.occurredAt)}</TableCell>
                    <TableCell>
                      {e.sourceUrl ? (
                        <a
                          href={e.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1"
                        >
                          {t("openSource", { source: t(`sources.${e.source as "GITHUB"}`) })}
                          <ExternalLink aria-hidden="true" className="size-3.5" />
                          <span className="sr-only">{t("newTab")}</span>
                        </a>
                      ) : (
                        t(`sources.${e.source as "GITHUB"}`)
                      )}
                    </TableCell>
                    <TableCell data-testid="evidence-seal">
                      <p className="flex items-center gap-1 text-sm">
                        {e.seal.anchor ? (
                          <ShieldCheck
                            aria-hidden="true"
                            className="size-4"
                            style={{ color: STATUS_STYLES.PASS.fg }}
                          />
                        ) : (
                          <Clock aria-hidden="true" className="size-4 text-muted-foreground" />
                        )}
                        {e.seal.anchor
                          ? t("sealAnchored", { date: dateTime(e.seal.anchor.timestampedAt) })
                          : e.seal.batch
                            ? t("sealPendingAnchor")
                            : t("sealPending")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span>
                          {t("sealHash", {
                            hash: `${e.seal.leafHash.slice(0, 4)}…${e.seal.leafHash.slice(-4)}`,
                          })}
                        </span>
                        {e.seal.batch && (
                          <span> · {t("sealBatch", { seq: e.seal.batch.seq })}</span>
                        )}
                        {e.seal.anchor && (
                          <span> · {t("sealAnchor", { seq: e.seal.anchor.seq })}</span>
                        )}
                      </p>
                      {e.seal.batch && (
                        <p className="text-xs">
                          <a href={`/api/evidence/${e.id}/proof`} download>
                            {t("downloadProof")}
                            <span className="sr-only"> · {e.summary}</span>
                          </a>
                        </p>
                      )}
                    </TableCell>
                  </tr>
                ))}
              </tbody>
            </Table>
            {evidence.pages > 1 && (
              <nav aria-label={t("pagination")} className="flex items-center gap-3 text-sm">
                {evidence.page > 1 && (
                  <Link href={`${base}?page=${evidence.page - 1}`}>{t("previous")}</Link>
                )}
                <span>{t("pageOf", { page: evidence.page, pages: evidence.pages })}</span>
                {evidence.page < evidence.pages && (
                  <Link href={`${base}?page=${evidence.page + 1}`}>{t("next")}</Link>
                )}
              </nav>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="actions-title" className="grid gap-4 md:grid-cols-2">
        <h3 id="actions-title" className="sr-only">
          {t("actionsTitle")}
        </h3>
        <OwnerForm
          controlId={control.id}
          ownerUserId={control.owner?.id ?? null}
          members={control.members}
          disabled={!canWrite}
        />
        {!control.naByReclassification && (
          <NotApplicableForm
            controlId={control.id}
            notApplicable={control.notApplicable}
            disabled={!canAdmin}
          />
        )}
      </section>

      <section aria-labelledby="comments-title" className="space-y-3">
        <h3 id="comments-title">{t("commentsTitle", { count: control.comments.length })}</h3>
        {control.comments.length === 0 ? (
          <p className="text-muted-foreground">{t("noComments")}</p>
        ) : (
          <ol className="space-y-2" data-testid="comments">
            {control.comments.map((c) => (
              <li key={c.id} className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  {t("commentBy", {
                    name: c.author.name ?? t("formerMember"),
                    when: dateTime(c.createdAt),
                  })}
                </p>
                <p className="mt-1 whitespace-pre-line">{c.body}</p>
              </li>
            ))}
          </ol>
        )}
        {canWrite && <CommentForm controlId={control.id} />}
      </section>
    </article>
  );
}
