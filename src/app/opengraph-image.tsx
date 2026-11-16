// Image de partage (Open Graph, X/Twitter) de la page d'accueil : générée au build, sans ressource externe.
import { ImageResponse } from "next/og";
import { createTranslator } from "next-intl";
import { loadMessages } from "@/i18n/config";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "ProofLayer";

export default async function OpenGraphImage() {
  const t = createTranslator({
    locale: "en",
    messages: await loadMessages("en"),
    namespace: "landing",
  });
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: "#003399",
        color: "#ffffff",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 34, fontWeight: 700 }}
      >
        <div style={{ width: 22, height: 22, background: "#ffcc00", transform: "rotate(45deg)" }} />
        {t("og.brand")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>{t("og.title")}</div>
        <div style={{ fontSize: 30, opacity: 0.9 }}>{t("og.subtitle")}</div>
      </div>
    </div>,
    size,
  );
}
