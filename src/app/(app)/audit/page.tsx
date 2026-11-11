// Journal d'audit (PL-106, §3.2 E10) : consultable et exportable par owner et admin.
import type { Metadata } from "next";
import Link from "next/link";
import { TRPCError } from "@trpc/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { AUDIT_ACTIONS, type AuditAction } from "@/server/services/audit";
import { requireSession } from "@/server/services/session";
import { ExportAuditButton } from "./export-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableCell, TableHead } from "@/components/ui/table";

type Search = { action?: string; from?: string; to?: string; cursor?: string };

const isAction = (v: unknown): v is AuditAction =>
  typeof v === "string" && (AUDIT_ACTIONS as readonly string[]).includes(v);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(v);
const actionKey = (a: AuditAction) => a.replace(".", "_") as `${string}_${string}`;

/** Titre du document (WCAG 2.4.2), complété par « · ProofLayer » (gabarit de src/app/layout.tsx). */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("audit"))("title") };
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireSession();
  const search = await searchParams;
  const t = await getTranslations("audit");
  const ta = await getTranslations("auditActions");
  const format = await getFormatter();

  const filters = {
    action: isAction(search.action) ? search.action : undefined,
    from: isDay(search.from) ? search.from : undefined,
    to: isDay(search.to) ? search.to : undefined,
  };

  const api = await serverCaller();
  let page: Awaited<ReturnType<typeof api.audit.list>>;
  try {
    page = await api.audit.list({ ...filters, cursor: search.cursor?.slice(0, 64) });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "FORBIDDEN") {
      return (
        <div className="space-y-4">
          <h1>{t("title")}</h1>
          <Alert tone="error">{t("forbidden")}</Alert>
        </div>
      );
    }
    throw error;
  }

  const query = (extra: Record<string, string | undefined>) =>
    "?" +
    new URLSearchParams(
      Object.entries({ ...filters, ...extra }).filter((e): e is [string, string] => !!e[1]),
    ).toString();

  return (
    <div className="space-y-4">
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>

      <form className="flex flex-wrap items-end gap-3" method="get" aria-label={t("apply")}>
        <Label>
          {t("filterAction")}
          <Select name="action" defaultValue={filters.action ?? ""}>
            <option value="">{t("allActions")}</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ta(actionKey(a) as never)}
              </option>
            ))}
          </Select>
        </Label>
        <Label>
          {t("from")}
          <Input type="date" name="from" defaultValue={filters.from ?? ""} />
        </Label>
        <Label>
          {t("to")}
          <Input type="date" name="to" defaultValue={filters.to ?? ""} />
        </Label>
        <Button type="submit">{t("apply")}</Button> <Link href="/audit">{t("reset")}</Link>
      </form>

      <ExportAuditButton filters={filters} />

      {page.entries.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <Table data-testid="audit-log">
          <thead>
            <tr>
              <TableHead scope="col">{t("date")}</TableHead>
              <TableHead scope="col">{t("actor")}</TableHead>
              <TableHead scope="col">{t("action")}</TableHead>
              <TableHead scope="col">{t("target")}</TableHead>
              <TableHead scope="col">{t("details")}</TableHead>
            </tr>
          </thead>
          <tbody>
            {page.entries.map((e) => (
              <tr key={e.id} data-testid="audit-entry" data-action={e.action}>
                <TableCell>
                  <time dateTime={e.createdAt}>
                    {format.dateTime(new Date(e.createdAt), {
                      dateStyle: "long",
                      timeStyle: "medium",
                    })}
                  </time>
                </TableCell>
                <TableCell>
                  {e.actorType !== "user"
                    ? t("system")
                    : e.actor
                      ? `${e.actor.name} (${e.actor.email})`
                      : t("unknownActor")}
                </TableCell>
                <TableCell>
                  {isAction(e.action) ? ta(actionKey(e.action) as never) : e.action}
                </TableCell>
                <TableCell>
                  {e.targetType} · <code>{e.targetId}</code>
                </TableCell>
                <TableCell>
                  <code>{JSON.stringify(e.metadata)}</code>
                </TableCell>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {page.nextCursor && (
        <Link href={`/audit${query({ cursor: page.nextCursor })}`}>{t("older")}</Link>
      )}
    </div>
  );
}
