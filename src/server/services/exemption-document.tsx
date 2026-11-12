// Dossier d'exemption en PDF (PL-205) : évaluation documentée (Art. 6(4)), classification de référence, champs de
// l'Annexe VIII section B, signature. Même rendu que la note de classification (@react-pdf/renderer, §4.2).
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { createTranslator } from "next-intl";
import { loadMessages, type Locale } from "@/i18n/config";
import { annexVIIIB } from "./annex-viii";
import type { signedDossierData } from "./exemption";

type DossierData = Awaited<ReturnType<typeof signedDossierData>>;

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: "Helvetica", lineHeight: 1.4, color: "#111827" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", lineHeight: 1.2, marginBottom: 6 },
  subtitle: { color: "#4b5563", marginBottom: 16 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6 },
  label: { color: "#4b5563" },
  block: { marginBottom: 8 },
  box: { borderWidth: 1, borderColor: "#d1d5db", padding: 8, marginTop: 4 },
  footer: { position: "absolute", bottom: 24, left: 48, right: 48, fontSize: 8, color: "#6b7280" },
});

export async function renderExemptionDocument(
  data: DossierData,
  locale: Locale,
  generatedAt: Date,
): Promise<Buffer> {
  const messages = await loadMessages(locale);
  const t = createTranslator({ locale, messages, namespace: "exemption" });
  const day = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso));
  const d = data.dossier;
  const fields = annexVIIIB({
    providerName: d.providerName,
    providerAddress: d.providerAddress,
    providerContact: d.providerContact,
    submitter: d.submitter,
    representative: d.representative,
    tradeName: d.tradeName,
    systemReference: data.system.id,
    intendedPurpose: data.system.intendedPurpose,
    art63Conditions: data.classification.art63Conditions,
    conditionJustification: d.conditionJustification,
    profilingJustification: d.profilingJustification,
    systemStatus: data.system.status,
    memberStates: d.memberStates,
  });
  const show = (field: (typeof fields)[number]) => {
    if (field.key === "status") return t(`annexB.statusValues.${field.value as "onMarket"}`);
    if (field.value === null || (Array.isArray(field.value) && field.value.length === 0)) {
      return t("annexB.none");
    }
    return Array.isArray(field.value) ? field.value.join(" ; ") : field.value;
  };

  const doc = (
    <Document title={`${t("pdf.title")} · ${data.system.name}`} language={locale}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{t("pdf.title")}</Text>
        <Text style={styles.subtitle}>{data.system.name}</Text>

        <Text style={styles.h2}>{t("pdf.classification")}</Text>
        <Text>
          {t("classificationRef", {
            date: data.classification.signedAt ? day(data.classification.signedAt) : "",
            points: data.classification.annexIIIPoints.join(", "),
            conditions: data.classification.art63Conditions.join(", "),
          })}
        </Text>
        <Text style={styles.label}>
          {data.system.placedOnMarketAt
            ? t("pdf.placedOnMarket", { date: day(data.system.placedOnMarketAt) })
            : t("pdf.notPlaced")}
        </Text>

        <Text style={styles.h2}>{t("pdf.assessment")}</Text>
        <View style={styles.block}>
          <Text style={styles.label}>{t("conditionJustification")}</Text>
          <Text>{d.conditionJustification}</Text>
        </View>
        <View style={styles.block}>
          <Text style={styles.label}>{t("profilingJustification")}</Text>
          <Text>{d.profilingJustification}</Text>
        </View>

        <Text style={styles.h2}>{t("annexB.title")}</Text>
        {fields.map((field) => (
          <View key={field.point} style={styles.block} wrap={false}>
            <Text style={styles.label}>
              {t("annexB.point", {
                point: field.point,
                label: t(`annexB.${field.key}` as "annexB.provider"),
              })}
            </Text>
            <Text>{show(field)}</Text>
          </View>
        ))}

        <Text style={styles.h2}>{t("pdf.signature")}</Text>
        <View style={styles.box} wrap={false}>
          <Text>{d.signature?.statement ?? ""}</Text>
          <Text>
            {t("signedBy", {
              date: d.signature ? day(d.signature.at) : "",
              name: d.signature?.name ?? "",
              title: d.signature?.title ?? "",
            })}
          </Text>
        </View>
        <Text style={{ marginTop: 16, color: "#4b5563" }}>
          {t("pdf.method", { version: data.classification.rulesetVersion })}
        </Text>
        <Text
          style={styles.footer}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${t("pdf.generatedAt", { date: day(generatedAt.toISOString()) })} · ${t("pdf.page", {
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
