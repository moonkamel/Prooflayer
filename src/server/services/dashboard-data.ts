// Calculs du dashboard (PL-406, §5.3 écran C) : fonctions pures. L'indicateur est la couverture de preuve (contrôles
// en PASS sur contrôles applicables), toujours accompagnée des contrôles en échec, périmés et sans preuve ; jamais de
// « score de conformité » (§5.2).
import type { ControlStatus } from "@/generated/prisma/enums";

export interface StatusCount {
  applicable: number;
  pass: number;
  fail: number;
  partial: number;
  stale: number;
  missing: number;
  notApplicable: number;
}

export function countStatuses(statuses: readonly ControlStatus[]): StatusCount {
  const count: StatusCount = {
    applicable: 0,
    pass: 0,
    fail: 0,
    partial: 0,
    stale: 0,
    missing: 0,
    notApplicable: 0,
  };
  for (const s of statuses) {
    if (s === "NOT_APPLICABLE") {
      count.notApplicable += 1;
      continue;
    }
    count.applicable += 1;
    if (s === "PASS") count.pass += 1;
    else if (s === "FAIL") count.fail += 1;
    else if (s === "PARTIAL") count.partial += 1;
    else if (s === "STALE") count.stale += 1;
    else count.missing += 1;
  }
  return count;
}

/** Article de rattachement d'une référence : « Art. 9(1)-(2) » → « Art. 9 » ; « Art. 6(2), Annexe III » → « Art. 6 ». */
export function articleOf(articleRef: string): string {
  return articleRef.match(/^Art\. \d+[a-z]?/u)?.[0] ?? articleRef;
}

/** Numéro de tri d'un article (« Art. 4a » après « Art. 4 »). */
export const articleOrder = (article: string) => {
  const m = article.match(/(\d+)([a-z]?)/u);
  return m ? Number(m[1]) * 10 + (m[2] ? m[2].charCodeAt(0) - 96 : 0) : Number.MAX_SAFE_INTEGER;
};

export interface TimelineInput {
  /** Instances applicables du système, avec leur date d'ouverture. */
  instances: { id: string; createdAt: Date; notApplicable: boolean }[];
  /** Évaluations des instances, dans n'importe quel ordre (y compris celles antérieures à la fenêtre). */
  evaluations: { controlInstanceId: string; status: ControlStatus; evaluatedAt: Date }[];
}

export interface TimelinePoint {
  /** Jour UTC (AAAA-MM-JJ), état à la fin du jour. */
  day: string;
  pass: number;
  applicable: number;
}

const DAY_MS = 86_400_000;

/**
 * Couverture de preuve à la fin de chacun des `days` derniers jours (aujourd'hui compris) : pour chaque instance ouverte
 * ce jour-là, le statut de sa dernière évaluation à cette date. Une instance non applicable aujourd'hui est écartée.
 */
export function coverageTimeline(input: TimelineInput, now: Date, days = 90): TimelinePoint[] {
  const byInstance = new Map<string, { status: ControlStatus; at: number }[]>();
  for (const e of input.evaluations) {
    const list = byInstance.get(e.controlInstanceId) ?? [];
    list.push({ status: e.status, at: e.evaluatedAt.getTime() });
    byInstance.set(e.controlInstanceId, list);
  }
  for (const list of byInstance.values()) list.sort((a, b) => a.at - b.at);
  const applicable = input.instances.filter((i) => !i.notApplicable);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const points: TimelinePoint[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const start = today - d * DAY_MS;
    const end = Math.min(start + DAY_MS - 1, now.getTime());
    let open = 0;
    let pass = 0;
    for (const i of applicable) {
      if (i.createdAt.getTime() > end) continue;
      open += 1;
      const evaluations = byInstance.get(i.id) ?? [];
      let last: ControlStatus | null = null;
      for (const e of evaluations) {
        if (e.at > end) break;
        last = e.status;
      }
      if (last === "PASS") pass += 1;
    }
    points.push({ day: new Date(start).toISOString().slice(0, 10), pass, applicable: open });
  }
  return points;
}

/** Source dominante des preuves d'un contrôle (la plus nombreuse ; à égalité, ordre alphabétique). */
export function dominantSource(counts: Record<string, number>): string | null {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
}

/** Connecteur dont dépend un évaluateur automatisé, pour l'état « Connectez … pour évaluer » (§5.3). */
export function connectorOf(evaluatorKey: string): "GITHUB" | "JIRA" | null {
  if (evaluatorKey.startsWith("github.")) return "GITHUB";
  if (evaluatorKey.startsWith("jira.")) return "JIRA";
  return null;
}
