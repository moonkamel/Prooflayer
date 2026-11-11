import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "ProofLayer",
};

// Coque minimale de PL-101. La langue, la navigation et les traductions arrivent avec PL-109 (next-intl).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
