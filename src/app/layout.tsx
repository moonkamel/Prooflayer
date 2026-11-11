import type { Metadata } from "next";
import "./globals.css";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";

export const metadata: Metadata = {
  title: { default: "ProofLayer", template: "%s · ProofLayer" },
};

// Racine : langue du document, traductions, feuille de style (PL-109). Coques : (app)/layout.tsx et (auth)/layout.tsx.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
