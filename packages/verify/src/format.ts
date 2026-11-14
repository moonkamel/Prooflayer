// Sortie lisible d'un rapport de vérification.
import { MESSAGES, type Lang } from "./messages.ts";
import type { VerifyReport } from "./verify.ts";

const MARK = { pass: "✓", warning: "!", fail: "✗", skipped: "·" } as const;

export function formatDate(iso: string | null, lang: Lang): string | null {
  if (!iso) return null;
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}

export function summaryLine(report: VerifyReport, lang: Lang): string {
  const s = report.summary;
  return MESSAGES[lang].summary({
    verified: s.verified,
    from: formatDate(s.sealedFrom, lang),
    to: formatDate(s.sealedTo, lang),
    alterations: s.alterations,
    undisclosed: s.undisclosed,
  });
}

export function formatReport(report: VerifyReport, lang: Lang): string {
  const t = MESSAGES[lang];
  const lines: string[] = [];
  if (report.pack) {
    lines.push(
      t.header({
        system: report.pack.system.name,
        organization: report.pack.organization.name,
        start: formatDate(report.pack.period.start, lang) ?? "—",
        end: formatDate(report.pack.period.end, lang) ?? "—",
      }),
    );
    if (report.pack.signingKid) lines.push(t.signedBy(report.pack.signingKid));
    lines.push("");
  }
  for (const step of report.steps) {
    const sep = lang === "fr" ? " : " : ": ";
    lines.push(
      `${MARK[step.status]} ${step.step}. ${t.steps[step.id]}${sep}${t.status[step.status]}`,
    );
    for (const issue of step.issues) {
      lines.push(
        `    ${issue.severity === "error" ? "✗" : "!"} ${t.issues[issue.code](issue.params)}`,
      );
    }
    if (step.issueCount > step.issues.length) {
      lines.push(`    ${t.more(step.issueCount - step.issues.length)}`);
    }
  }
  lines.push("");
  for (const ts of report.summary.timestamps) {
    lines.push(
      t.timestamp({
        anchor: ts.anchor,
        date: formatDate(ts.genTime, lang) ?? ts.genTime,
        tsa: ts.tsa,
        qualified: ts.qualified,
      }),
    );
  }
  if (report.summary.declarative > 0) lines.push(t.declarative(report.summary.declarative));
  if (report.summary.redacted > 0) lines.push(t.redacted(report.summary.redacted));
  lines.push("", summaryLine(report, lang));
  lines.push(report.ok ? (report.clean ? t.result.ok : t.result.okWithWarnings) : t.result.fail);
  return `${lines.join("\n")}\n`;
}
