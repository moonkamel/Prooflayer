// Journal d'audit (PL-106, §3.2 E10) : consultable et exportable par owner et admin.
import Link from "next/link";
import { TRPCError } from "@trpc/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { AUDIT_ACTIONS, type AuditAction } from "@/server/services/audit";
import { requireSession } from "@/server/services/session";
import { ExportAuditButton } from "./export-button";

type Search = { action?: string; from?: string; to?: string; cursor?: string };

const isAction = (v: unknown): v is AuditAction =>
  typeof v === "string" && (AUDIT_ACTIONS as readonly string[]).includes(v);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(v);
const actionKey = (a: AuditAction) => a.replace(".", "_") as `${string}_${string}`;

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
        <main>
          <h1>{t("title")}</h1>
          <p role="alert">{t("forbidden")}</p>
        </main>
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
    <main>
      <h1>{t("title")}</h1>
      <p>{t("intro")}</p>

      <form method="get" aria-label={t("apply")}>
        <label>
          {t("filterAction")}
          <select name="action" defaultValue={filters.action ?? ""}>
            <option value="">{t("allActions")}</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {ta(actionKey(a) as never)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("from")}
          <input type="date" name="from" defaultValue={filters.from ?? ""} />
        </label>
        <label>
          {t("to")}
          <input type="date" name="to" defaultValue={filters.to ?? ""} />
        </label>
        <button type="submit">{t("apply")}</button> <Link href="/audit">{t("reset")}</Link>
      </form>

      <ExportAuditButton filters={filters} />

      {page.entries.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <table data-testid="audit-log">
          <thead>
            <tr>
              <th scope="col">{t("date")}</th>
              <th scope="col">{t("actor")}</th>
              <th scope="col">{t("action")}</th>
              <th scope="col">{t("target")}</th>
              <th scope="col">{t("details")}</th>
            </tr>
          </thead>
          <tbody>
            {page.entries.map((e) => (
              <tr key={e.id} data-testid="audit-entry" data-action={e.action}>
                <td>
                  <time dateTime={e.createdAt}>
                    {format.dateTime(new Date(e.createdAt), {
                      dateStyle: "long",
                      timeStyle: "medium",
                    })}
                  </time>
                </td>
                <td>
                  {e.actorType !== "user"
                    ? t("system")
                    : e.actor
                      ? `${e.actor.name} (${e.actor.email})`
                      : t("unknownActor")}
                </td>
                <td>{isAction(e.action) ? ta(actionKey(e.action) as never) : e.action}</td>
                <td>
                  {e.targetType} · <code>{e.targetId}</code>
                </td>
                <td>
                  <code>{JSON.stringify(e.metadata)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {page.nextCursor && (
        <Link href={`/audit${query({ cursor: page.nextCursor })}`}>{t("older")}</Link>
      )}
    </main>
  );
}
