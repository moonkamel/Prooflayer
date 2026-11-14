// Rapport PDF du pack (PL-504, §3.2 E9) : lisible par un non-technicien. Identité du système, classification signée,
// contrôles par article avec statut, contrôles en échec ou sans preuve (jamais masqués), preuves par contrôle (les
// déclaratives marquées comme telles), méthode de vérification. Français ou anglais ; textes dans messages/{fr,en}.json
// (`packReport`). Jamais le mot « conforme » (règle 7).
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { createTranslator } from "next-intl";
import { loadMessages, type Locale } from "@/i18n/config";
import { articleOf, articleOrder } from "@/server/services/dashboard-data";
import type { PackControl, PackEvidence } from "./contents";

/** Preuves listées par contrôle dans le rapport ; au-delà, le décompte (toutes figurent dans evidence/). */
export const REPORT_EVIDENCE_PER_CONTROL = 100;

/** Commande de vérification, identique dans toutes les langues. */
export const VERIFY_COMMAND = "npx @prooflayer/verify pack.zip";

export interface ReportInput {
  locale: Locale;
  generatedAt: Date;
  organization: string;
  system: {
    name: string;
    intendedPurpose: string;
    owner: string | null;
    riskTier: string | null;
    role: string | null;
  };
  classification: {
    tier: string;
    role: string;
    annexIIIPoints: string[];
    rulesetVersion: string;
    signedAt: Date;
    signedBy: string;
    signedTitle: string;
  } | null;
  period: { start: string; end: string };
  controls: PackControl[];
  evidence: Pick<
    PackEvidence,
    "id" | "summary" | "occurredAt" | "declarative" | "redactedAt" | "kind"
  >[];
  counts: {
    leaves: number;
    disclosed: number;
    batches: number;
    anchors: number;
    unanchoredBatches: number;
  };
  signingKid: string;
  /** Rubriques des gabarits joints restant à rédiger (PL-506). */
  templates?: { annexIvEmpty: number; annexIvPartial: number; annexVToWrite: number };
}

const styles = StyleSheet.create({
  page: { padding: 44, fontSize: 9.5, fontFamily: "Helvetica", lineHeight: 1.4, color: "#0f172a" },
  rule: { flexDirection: "row", height: 4, marginBottom: 14 },
  title: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.2,
    marginBottom: 4,
    color: "#002a80",
  },
  subtitle: { color: "#475569", marginBottom: 14 },
  h2: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginTop: 14,
    marginBottom: 6,
    color: "#002a80",
  },
  h3: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 3 },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 150, color: "#475569" },
  value: { flex: 1 },
  tr: { flexDirection: "row", borderTopWidth: 0.5, borderTopColor: "#dbe3f0", paddingVertical: 3 },
  key: { width: 70, fontFamily: "Courier" },
  ctitle: { flex: 1, paddingRight: 6 },
  status: { width: 80, fontFamily: "Helvetica-Bold" },
  count: { width: 72, textAlign: "right" },
  box: { borderWidth: 0.75, borderColor: "#c5cfdf", padding: 8, marginTop: 4 },
  ev: { flexDirection: "row", paddingVertical: 1.5, paddingLeft: 10 },
  evDate: { width: 70, color: "#475569" },
  evText: { flex: 1 },
  // Placé par le haut (A4 : 841,89 pt) : avec `bottom`, react-pdf n'affiche pas un pied qui hérite d'un lineHeight.
  footer: {
    position: "absolute",
    top: 812,
    left: 44,
    right: 44,
    fontSize: 7.5,
    color: "#64748b",
  },
});

const STATUS_COLORS: Record<string, string> = {
  PASS: "#14532d",
  FAIL: "#7f1d1d",
  PARTIAL: "#713f12",
  STALE: "#7c2d12",
  MISSING: "#334155",
  NOT_APPLICABLE: "#3f3f46",
};

export async function renderPackReport(input: ReportInput): Promise<Buffer> {
  const messages = await loadMessages(input.locale);
  const t = createTranslator({ locale: input.locale, messages, namespace: "packReport" });
  const ts = createTranslator({ locale: input.locale, messages, namespace: "controlStatus" });
  const tk = createTranslator({ locale: input.locale, messages, namespace: "riskTier" });
  const tr = createTranslator({ locale: input.locale, messages, namespace: "aiActRole" });
  const tt = createTranslator({
    locale: input.locale,
    messages,
    namespace: "packTemplates.report",
  });
  const dateFmt = new Intl.DateTimeFormat(input.locale === "en" ? "en-GB" : "fr-FR", {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const day = (d: Date | string) => dateFmt.format(typeof d === "string" ? new Date(d) : d);
  const evidenceById = new Map(input.evidence.map((e) => [e.id, e]));
  const controls = [...input.controls].sort(
    (a, b) =>
      articleOrder(articleOf(a.articleRef)) - articleOrder(articleOf(b.articleRef)) ||
      a.key.localeCompare(b.key),
  );
  const articles = [...new Set(controls.map((c) => articleOf(c.articleRef)))];
  const gaps = controls.filter((c) => !c.notApplicable && c.status !== "PASS");
  const status = (c: PackControl) => ts((c.notApplicable ? "NOT_APPLICABLE" : c.status) as "PASS");
  const color = (c: PackControl) => STATUS_COLORS[c.notApplicable ? "NOT_APPLICABLE" : c.status];
  const tierLabel = (tier: string | null) => (tier ? tk(tier as "HIGH_RISK") : t("unclassified"));
  const roleLabel = (role: string | null) => (role ? tr(role as "PROVIDER") : "—");

  // Pied de page traduit une fois ; numéros posés à chaque page (le rendu les fournit page par page).
  const footer = t("footer", { system: input.system.name, page: "\u0001", pages: "\u0002" });
  const doc = (
    <Document
      title={t("documentTitle", { system: input.system.name })}
      author="ProofLayer"
      language={input.locale}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.rule} fixed>
          <View style={{ flex: 1, backgroundColor: "#003399" }} />
          <View style={{ width: 40, backgroundColor: "#ffcc00" }} />
        </View>
        <Text style={styles.title}>{t("title", { system: input.system.name })}</Text>
        <Text style={styles.subtitle}>
          {t("subtitle", {
            organization: input.organization,
            start: day(input.period.start),
            end: day(input.period.end),
            generated: day(input.generatedAt),
          })}
        </Text>

        <Text style={styles.h2}>{t("identity")}</Text>
        <View style={styles.row}>
          <Text style={styles.label}>{t("purpose")}</Text>
          <Text style={styles.value}>{input.system.intendedPurpose}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>{t("owner")}</Text>
          <Text style={styles.value}>{input.system.owner ?? "—"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>{t("tier")}</Text>
          <Text style={styles.value}>{tierLabel(input.system.riskTier)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>{t("role")}</Text>
          <Text style={styles.value}>{roleLabel(input.system.role)}</Text>
        </View>

        <Text style={styles.h2}>{t("classification")}</Text>
        {input.classification ? (
          <View style={styles.box}>
            <Text>
              {t("classificationLine", {
                tier: tierLabel(input.classification.tier),
                points: input.classification.annexIIIPoints.join(", ") || "—",
                role: roleLabel(input.classification.role),
              })}
            </Text>
            <Text>
              {t("signedLine", {
                date: day(input.classification.signedAt),
                name: input.classification.signedBy,
                title: input.classification.signedTitle,
                version: input.classification.rulesetVersion,
              })}
            </Text>
          </View>
        ) : (
          <Text>{t("noClassification")}</Text>
        )}

        <Text style={styles.h2}>{t("gaps", { count: gaps.length })}</Text>
        {gaps.length === 0 ? (
          <Text>{t("noGaps")}</Text>
        ) : (
          gaps.map((c) => (
            <View key={c.key} style={styles.tr} wrap={false}>
              <Text style={styles.key}>{c.key}</Text>
              <Text style={styles.ctitle}>{c.title[input.locale]}</Text>
              <Text style={[styles.status, { color: color(c) }]}>{status(c)}</Text>
            </View>
          ))
        )}

        <Text style={styles.h2}>{t("controls", { count: controls.length })}</Text>
        {articles.map((article) => (
          <View key={article}>
            <Text style={styles.h3}>{article}</Text>
            {controls
              .filter((c) => articleOf(c.articleRef) === article)
              .map((c) => (
                <View key={c.key} wrap={false}>
                  <View style={styles.tr}>
                    <Text style={styles.key}>{c.key}</Text>
                    <Text style={styles.ctitle}>{c.title[input.locale]}</Text>
                    <Text style={[styles.status, { color: color(c) }]}>{status(c)}</Text>
                    <Text style={styles.count}>
                      {t("evidenceCount", { count: c.evidenceIds.length })}
                    </Text>
                  </View>
                  {c.notApplicable && c.justification ? (
                    <Text style={styles.ev}>{t("justification", { text: c.justification })}</Text>
                  ) : null}
                </View>
              ))}
          </View>
        ))}

        <Text style={styles.h2} break>
          {t("evidenceByControl")}
        </Text>
        {controls
          .filter((c) => c.evidenceIds.length > 0)
          .map((c) => (
            <View key={c.key}>
              <Text style={styles.h3}>
                {c.key} · {c.title[input.locale]}
              </Text>
              {c.evidenceIds.slice(0, REPORT_EVIDENCE_PER_CONTROL).map((id) => {
                const e = evidenceById.get(id);
                if (!e) return null;
                return (
                  <View key={id} style={styles.ev} wrap={false}>
                    <Text style={styles.evDate}>{day(e.occurredAt)}</Text>
                    <Text style={styles.evText}>
                      {e.redactedAt ? t("redacted") : e.summary}
                      {e.declarative ? ` · ${t("declarative")}` : ""} · {id}
                    </Text>
                  </View>
                );
              })}
              {c.evidenceIds.length > REPORT_EVIDENCE_PER_CONTROL ? (
                <Text style={styles.ev}>
                  {t("moreEvidence", { count: c.evidenceIds.length - REPORT_EVIDENCE_PER_CONTROL })}
                </Text>
              ) : null}
            </View>
          ))}

        <Text style={styles.h2} break>
          {t("method")}
        </Text>
        <Text>{t("methodIntro")}</Text>
        <View style={styles.box}>
          <Text>
            {t("sealing", {
              leaves: input.counts.leaves,
              disclosed: input.counts.disclosed,
              batches: input.counts.batches,
              anchors: input.counts.anchors,
            })}
          </Text>
          {input.counts.unanchoredBatches > 0 ? (
            <Text>{t("unanchored", { count: input.counts.unanchoredBatches })}</Text>
          ) : null}
          <Text>{t("window")}</Text>
          <Text>{t("declarativeNote")}</Text>
          <Text>{t("signature", { kid: input.signingKid })}</Text>
        </View>
        {input.templates ? (
          <View>
            <Text style={styles.h2}>{tt("title")}</Text>
            <Text>
              {tt("annexIv", {
                empty: input.templates.annexIvEmpty,
                partial: input.templates.annexIvPartial,
              })}
            </Text>
            <Text>{tt("annexV", { count: input.templates.annexVToWrite })}</Text>
          </View>
        ) : null}
        <Text style={{ marginTop: 8 }}>{t("command")}</Text>
        <Text style={{ fontFamily: "Courier", marginTop: 2 }}>{VERIFY_COMMAND}</Text>

        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            footer
              .replace("\u0001", String(pageNumber))
              .replace("\u0002", String(totalPages ?? pageNumber))
          }
        />
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
