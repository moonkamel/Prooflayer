"use client";

// Tableau du dashboard système (§5.3 écran C) : filtres (statut, article, responsable, source, recherche) appliqués
// instantanément et reflétés dans l'adresse (lien partageable, retour arrière), contrôles groupés par article avec
// lignes repliables, décompte annoncé aux lecteurs d'écran. Aucune donnée n'est rechargée au filtrage.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { CONTROL_STATUSES, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DashboardControl } from "@/server/services/dashboard";
import { cn } from "@/lib/utils";

const ALL = "";
const NOBODY = "none";

export function ControlsExplorer({
  systemId,
  controls,
  canWrite,
}: {
  systemId: string;
  controls: DashboardControl[];
  canWrite: boolean;
}) {
  const t = useTranslations("dashboard");
  const ts = useTranslations("controlStatus");
  const locale = useLocale() === "en" ? "en" : "fr";
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ids = { status: useId(), article: useId(), owner: useId(), source: useId(), q: useId() };

  const [filters, setFilters] = useState({
    status: params.get("status") ?? ALL,
    article: params.get("article") ?? ALL,
    owner: params.get("owner") ?? ALL,
    source: params.get("source") ?? ALL,
    q: params.get("q") ?? "",
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const update = (patch: Partial<typeof filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) search.set(k, v);
    const query = search.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const articles = useMemo(() => [...new Set(controls.map((c) => c.article))], [controls]);
  const owners = useMemo(
    () => [
      ...new Map(
        controls.flatMap((c) => (c.owner ? [[c.owner.id, c.owner.name] as const] : [])),
      ).entries(),
    ],
    [controls],
  );
  const sources = useMemo(
    () => [...new Set(controls.flatMap((c) => Object.keys(c.sources)))].sort(),
    [controls],
  );

  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return controls.filter(
      (c) =>
        (!filters.status || c.status === filters.status) &&
        (!filters.article || c.article === filters.article) &&
        (!filters.owner || (filters.owner === NOBODY ? !c.owner : c.owner?.id === filters.owner)) &&
        (!filters.source || (c.sources[filters.source] ?? 0) > 0) &&
        (!q || c.key.toLowerCase().includes(q) || c.title[locale].toLowerCase().includes(q)),
    );
  }, [controls, filters, locale]);

  const groups = useMemo(() => {
    const map = new Map<string, DashboardControl[]>();
    for (const c of visible) map.set(c.article, [...(map.get(c.article) ?? []), c]);
    return [...map.entries()];
  }, [visible]);

  const toggle = (article: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(article)) next.delete(article);
      else next.add(article);
      return next;
    });
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-3">
      <form
        role="search"
        aria-label={t("filters")}
        className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-surface p-3"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="min-w-48 flex-1">
          <Label htmlFor={ids.q}>{t("search")}</Label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={ids.q}
              type="search"
              className="pl-8"
              value={filters.q}
              onChange={(e) => update({ q: e.target.value })}
            />
          </div>
        </div>
        <div>
          <Label htmlFor={ids.status}>{t("status")}</Label>
          <Select
            id={ids.status}
            value={filters.status}
            onChange={(e) => update({ status: e.target.value })}
          >
            <option value={ALL}>{t("all")}</option>
            {CONTROL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ts(s)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={ids.article}>{t("article")}</Label>
          <Select
            id={ids.article}
            value={filters.article}
            onChange={(e) => update({ article: e.target.value })}
          >
            <option value={ALL}>{t("allArticles")}</option>
            {articles.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={ids.owner}>{t("owner")}</Label>
          <Select
            id={ids.owner}
            value={filters.owner}
            onChange={(e) => update({ owner: e.target.value })}
          >
            <option value={ALL}>{t("all")}</option>
            <option value={NOBODY}>{t("nobody")}</option>
            {owners.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={ids.source}>{t("source")}</Label>
          <Select
            id={ids.source}
            value={filters.source}
            onChange={(e) => update({ source: e.target.value })}
          >
            <option value={ALL}>{t("all")}</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {t(`sources.${s as "GITHUB"}`)}
              </option>
            ))}
          </Select>
        </div>
        {filtered && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => update({ status: "", article: "", owner: "", source: "", q: "" })}
          >
            {t("reset")}
          </Button>
        )}
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" className="text-sm text-muted-foreground" data-testid="results">
          {t("results", { count: visible.length })}
        </p>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={() => setCollapsed(new Set())}>
            {t("expandAll")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(new Set(articles))}
          >
            {t("collapseAll")}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-sm" data-testid="dashboard-controls">
          <thead className="bg-surface text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("control")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("status")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("evidence")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("owner")}
              </th>
            </tr>
          </thead>
          {groups.map(([article, items]) => {
            const open = !collapsed.has(article);
            const pass = items.filter((c) => c.status === "PASS").length;
            const applicable = items.filter((c) => c.status !== "NOT_APPLICABLE").length;
            return (
              <tbody key={article} data-testid="article-group" data-article={article}>
                <tr className="border-t border-border bg-accent">
                  <th scope="rowgroup" colSpan={4} className="px-1 py-1 text-left">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggle(article)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-sm font-semibold text-accent-foreground hover:bg-background/60"
                    >
                      {open ? (
                        <ChevronDown aria-hidden="true" className="size-4" />
                      ) : (
                        <ChevronRight aria-hidden="true" className="size-4" />
                      )}
                      <span>{t("group", { article, pass, applicable })}</span>
                      <span className="sr-only">
                        {open ? t("collapse", { article }) : t("expand", { article })}
                      </span>
                    </button>
                  </th>
                </tr>
                {open &&
                  items.map((c) => (
                    <tr
                      key={c.id}
                      data-testid="dashboard-control"
                      data-key={c.key}
                      className="border-t border-border transition-colors hover:bg-surface motion-reduce:transition-none"
                    >
                      <td className="px-3 py-2 align-top">
                        <p className="font-medium">
                          <code className="mr-1 rounded bg-muted px-1 py-0.5">{c.key}</code>
                          {c.title[locale]}
                        </p>
                        <p className="text-xs text-muted-foreground">{c.articleRef}</p>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <StatusBadge status={c.status} />
                        {c.needsConnector && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("connect", { provider: t(`sources.${c.needsConnector}`) })}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 align-top tabular-nums">
                        {c.dominantSource
                          ? t("sourceCount", {
                              source: t(`sources.${c.dominantSource as "GITHUB"}`),
                              count: c.evidenceCount,
                            })
                          : t("noSource")}
                        {canWrite &&
                          c.automation !== "AUTOMATED" &&
                          c.status !== "NOT_APPLICABLE" && (
                            <p className="mt-1 text-xs">
                              <a href={`/systems/${systemId}/controls/${c.id}/evidence`}>
                                {t("addEvidence")}
                                <span className="sr-only"> · {c.key}</span>
                              </a>
                            </p>
                          )}
                      </td>
                      <td
                        className={cn("px-3 py-2 align-top", !c.owner && "text-muted-foreground")}
                      >
                        {c.owner?.name ?? t("nobody")}
                      </td>
                    </tr>
                  ))}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
