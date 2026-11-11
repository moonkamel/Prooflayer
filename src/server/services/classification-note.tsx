// Note de classification en PDF (PL-204, §9.4) : française ou anglaise, avec trace de raisonnement, réponses et
// version des règles ; lisible par un non-technicien (DoD du sprint 2). @react-pdf/renderer (§4.2) : JavaScript pur,
// sans navigateur à embarquer. Aucun texte en dur : messages/{fr,en}.json, espace `classificationResult.note`.
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { createTranslator } from "next-intl";
import { traceLines } from "@/server/classify/explain";
import { QUESTIONS, type QuestionId } from "@/server/classify/questionnaire";
import { loadMessages, type Locale } from "@/i18n/config";
import type { classificationNote } from "./classification";

type NoteData = Awaited<ReturnType<typeof classificationNote>>;

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: "Helvetica", lineHeight: 1.4, color: "#111827" },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold", lineHeight: 1.2, marginBottom: 6 },
  subtitle: { color: "#4b5563", marginBottom: 16 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6 },
  tier: { fontSize: 14, fontFamily: "Helvetica-Bold", lineHeight: 1.2, marginBottom: 4 },
  row: { flexDirection: "row", marginBottom: 3 },
  label: { width: 150, color: "#4b5563" },
  value: { flex: 1 },
  traceLine: { flexDirection: "row", marginBottom: 4 },
  traceIndex: { width: 18 },
  article: { color: "#4b5563" },
  concludes: { fontFamily: "Helvetica-Bold" },
  box: { borderWidth: 1, borderColor: "#d1d5db", padding: 8, marginTop: 4 },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, fontSize: 8, color: "#6b7280" },
});

export async function renderClassificationNote(
  data: NoteData,
  locale: Locale,
  generatedAt: Date,
): Promise<Buffer> {
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "classificationResult" });
  const tq = createTranslator({ locale, messages, namespace: "questionnaire" });
  const tk = createTranslator({ locale, messages, namespace: "riskTier" });
  const tr = createTranslator({ locale, messages, namespace: "aiActRole" });
  const c = data.classification;
  const result = c.result!;
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso));

  const answerOf = (id: QuestionId) => {
    const value = c.responses[id];
    if (value === undefined) return t("noAnswer");
    if (typeof value === "boolean") return value ? tq("yes") : tq("no");
    if (value.length === 0) return tq("none");
    return value.map((o) => tq(`questions.${id}.options.${o}` as never)).join(" ; ");
  };

  const doc = (
    <Document title={`${t("note.title")} · ${data.system.name}`} language={locale}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{t("note.title")}</Text>
        <Text style={styles.subtitle}>
          {data.system.name} · {t("rules", { version: c.rulesetVersion })}
        </Text>

        <View style={styles.row}>
          <Text style={styles.label}>{t("note.system")}</Text>
          <Text style={styles.value}>{data.system.name}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>{t("note.purpose")}</Text>
          <Text style={styles.value}>{data.system.intendedPurpose}</Text>
        </View>
        {data.system.owner && (
          <View style={styles.row}>
            <Text style={styles.label}>{t("note.owner")}</Text>
            <Text style={styles.value}>{data.system.owner}</Text>
          </View>
        )}

        <Text style={styles.h2}>{t("note.result")}</Text>
        <Text style={styles.tier}>{tk(result.tier)}</Text>
        {result.annexIIIPoints.length > 0 && (
          <Text>{t("annex", { points: result.annexIIIPoints.join(", ") })}</Text>
        )}
        <Text>{t("role", { role: tr(result.role) })}</Text>
        {result.art63Conditions.length > 0 && (
          <Text>
            {t("note.conditions")} : {result.art63Conditions.join(", ")}
          </Text>
        )}
        <Text>
          {t("note.profiling")} : {result.involvesProfiling ? t("note.yes") : t("note.no")}
        </Text>

        <Text style={styles.h2}>{t("why")}</Text>
        {traceLines(result.reasoning).map((line, i) => (
          <View key={line.key} style={styles.traceLine} wrap={false}>
            <Text style={styles.traceIndex}>{String(i + 1)}</Text>
            <View style={styles.value}>
              <Text style={line.concludes ? styles.concludes : {}}>
                {t(`trace.${line.key}` as never)}
              </Text>
              <Text style={styles.article}>
                {line.articleRef}
                {line.questionId ? ` · ${t("answer", { answer: answerOf(line.questionId) })}` : ""}
              </Text>
            </View>
          </View>
        ))}

        <Text style={styles.h2}>{t("note.answers")}</Text>
        {c.answered.map((id) => (
          <View key={id} style={{ marginBottom: 6 }} wrap={false}>
            <Text>{tq(`questions.${id}.title` as never)}</Text>
            <Text style={styles.article}>
              {QUESTIONS[id].articleRef} · {answerOf(id)}
            </Text>
          </View>
        ))}

        <Text style={styles.h2}>{t("note.signature")}</Text>
        <View style={styles.box} wrap={false}>
          {c.signature?.at ? (
            <>
              <Text>{c.signature.statement}</Text>
              <Text>
                {t("signedBy", {
                  date: day(c.signature.at),
                  name: c.signature.name ?? "",
                  title: c.signature.title ?? "",
                })}
              </Text>
            </>
          ) : (
            <Text>{t("note.unsigned")}</Text>
          )}
        </View>

        <Text style={{ marginTop: 16, color: "#4b5563" }}>
          {t("note.method", { version: c.rulesetVersion })}
        </Text>
        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${t("note.generatedAt", { date: day(generatedAt.toISOString()) })} · ${t("note.page", {
              page: pageNumber,
              pages: totalPages,
            })}`
          }
        />
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
